// Initialize map variables
let map;
let routingControl;
let heatmapLayer;
let currentLocationMarker = null;
let username = localStorage.getItem('username') || '';
let userRoutes = {};
let routePoints = [];

// Initialize Firebase references
const routesRef = firebase.database().ref('routes');
const trafficRef = firebase.database().ref('traffic_data');

// Initialize map
function initMap() {
    map = L.map('map').setView([0, 0], 2);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: ' OpenStreetMap contributors'
    }).addTo(map);
    
    // Initialize empty heatmap layer
    heatmapLayer = L.heatLayer([], {
        radius: 25,
        blur: 15,
        maxZoom: 10,
        max: 1.0,
        gradient: {0.4: 'blue', 0.6: 'yellow', 0.8: 'orange', 1: 'red'}
    }).addTo(map);
    
    // Get user location
    getCurrentLocation();
    
    // Initialize search functionality
    initializeSearch();
}

// Initialize search functionality
function initializeSearch() {
    const searchInput = document.getElementById('search');
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query) {
                    searchLocation(query);
                }
            }
        });
    }
}

// Initialize map when page loads
document.addEventListener('DOMContentLoaded', initMap);

// Set username function
function setUsername() {
    const usernameInput = document.getElementById('username');
    username = usernameInput.value.trim();
    if (username) {
        localStorage.setItem('username', username);
        alert('Username set successfully!');
    } else {
        alert('Please enter a valid username');
    }
}

// Function to get coordinates from location name
async function getCoordinates(locationName) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}`);
        const data = await response.json();
        if (data.length > 0) {
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
        throw new Error('Location not found');
    } catch (error) {
        throw new Error('Error finding location');
    }
}

// Function to calculate route points at regular intervals
function getRoutePoints(route) {
    const points = [];
    if (!route || !route.coordinates) {
        console.error('Invalid route object:', route);
        return points;
    }

    // Extract coordinates from the route
    let coordinates = [];
    if (Array.isArray(route.coordinates)) {
        coordinates = route.coordinates;
    } else if (route.waypoints) {
        coordinates = route.waypoints.map(wp => ({
            lat: wp.latLng.lat,
            lng: wp.latLng.lng
        }));
    }
    
    // Sample points along the route
    for (let i = 0; i < coordinates.length; i++) {
        const coord = coordinates[i];
        points.push({
            lat: coord.lat || coord.latitude || 0,
            lng: coord.lng || coord.longitude || 0,
            timestamp: estimateTimestamp(i, coordinates.length)
        });
    }
    
    return points;
}

// Function to estimate timestamp for each point
function estimateTimestamp(pointIndex, totalPoints) {
    const departureTimeInput = document.getElementById('departure-time');
    if (!departureTimeInput || !departureTimeInput.value) {
        return Date.now() + (pointIndex * 300000); // Default: current time + 5 min intervals
    }
    
    const departureTime = new Date(departureTimeInput.value).getTime();
    const averageSpeed = 50; // km/h
    const estimatedDuration = totalPoints * (3600 / averageSpeed); // seconds
    return departureTime + (pointIndex * (estimatedDuration / totalPoints) * 1000);
}

// Function to predict traffic intensity at a point
async function predictTrafficIntensity(point, timestamp) {
    try {
        console.log('Predicting traffic for point:', point, 'at time:', new Date(timestamp));
        
        // Get all traffic data points within the time window
        const snapshot = await trafficRef.once('value');
        const trafficData = snapshot.val() || {};
        
        let nearbyPoints = 0;
        const timeWindow = 30 * 60 * 1000; // 30 minutes in milliseconds
        const distanceThreshold = 0.5; // 0.5 km radius
        
        Object.values(trafficData).forEach(data => {
            // Check if point is within time window
            const timeDiff = Math.abs(data.timestamp - timestamp);
            if (timeDiff <= timeWindow) {
                // Calculate distance between points
                const distance = calculateDistance(
                    point.lat, point.lng,
                    data.lat, data.lng
                );
                
                // If within threshold, increment counter
                if (distance <= distanceThreshold) {
                    nearbyPoints++;
                }
            }
        });
        
        console.log('Found nearby points:', nearbyPoints);
        
        // Calculate intensity (0-10 scale)
        const intensity = Math.min(nearbyPoints, 10);
        return intensity;
        
    } catch (error) {
        console.error('Error predicting traffic:', error);
        return 0;
    }
}

// Function to calculate distance between two points
function calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in km
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLon = (point2.lng - point1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Function to update heatmap
async function updateHeatmap(route) {
    try {
        console.log('Updating heatmap with route:', route);
        
        // Get route coordinates
        let coordinates = [];
        if (route.coordinates) {
            coordinates = route.coordinates;
        } else if (route.waypoints) {
            coordinates = route.waypoints.map(wp => ({
                lat: wp.latLng.lat,
                lng: wp.latLng.lng
            }));
        }
        
        if (coordinates.length === 0) {
            console.warn('No coordinates found in route');
            return;
        }
        
        // Generate points along the route
        const points = [];
        for (let i = 0; i < coordinates.length; i++) {
            points.push({
                lat: coordinates[i].lat,
                lng: coordinates[i].lng,
                timestamp: estimateTimestamp(i, coordinates.length)
            });
        }
        
        console.log('Generated route points:', points);
        
        // Get traffic data from Firebase
        const snapshot = await trafficRef.once('value');
        const trafficData = snapshot.val() || {};
        
        // Process each point
        const heatmapData = [];
        for (const point of points) {
            let intensity = 0;
            
            // Count nearby points
            Object.values(trafficData).forEach(data => {
                const timeDiff = Math.abs(data.timestamp - point.timestamp);
                if (timeDiff <= 30 * 60 * 1000) { // 30 minutes window
                    const distance = calculateDistance(
                        point.lat, point.lng,
                        data.lat, data.lng
                    );
                    if (distance <= 0.5) { // 500m radius
                        intensity++;
                    }
                }
            });
            
            // Normalize intensity (0-1 scale)
            intensity = Math.min(intensity / 10, 1);
            
            if (intensity > 0) {
                heatmapData.push([point.lat, point.lng, intensity]);
            }
        }
        
        console.log('Generated heatmap data:', heatmapData);
        
        // Update heatmap layer
        if (heatmapLayer) {
            map.removeLayer(heatmapLayer);
        }
        
        heatmapLayer = L.heatLayer(heatmapData, {
            radius: 25,
            blur: 15,
            maxZoom: 10,
            max: 1.0,
            gradient: {0.4: 'blue', 0.6: 'yellow', 0.8: 'orange', 1: 'red'}
        }).addTo(map);
        
    } catch (error) {
        console.error('Error updating heatmap:', error);
    }
}

// Function to find route between source and destination
async function findRoute() {
    try {
        const sourceInput = document.getElementById('source').value;
        const destInput = document.getElementById('destination').value;
        const departureTime = document.getElementById('departure-time').value;

        if (!sourceInput || !destInput) {
            alert('Please enter source and destination locations');
            return;
        }

        // Get coordinates for both locations
        const sourceCoords = await getCoordinates(sourceInput);
        const destCoords = await getCoordinates(destInput);

        // Remove existing route if any
        if (routingControl) {
            map.removeControl(routingControl);
        }

        // Create new route
        routingControl = L.Routing.control({
            waypoints: [
                L.latLng(sourceCoords[0], sourceCoords[1]),
                L.latLng(destCoords[0], destCoords[1])
            ],
            routeWhileDragging: true,
            lineOptions: {
                styles: [{ color: '#3388ff', weight: 6 }]
            },
            show: false,
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: true
        }).addTo(map);

        // Wait for route calculation
        routingControl.on('routesfound', function(e) {
            console.log('Routes found:', e);
            const routes = e.routes;
            if (routes && routes.length > 0) {
                const route = routes[0];
                console.log('Processing route:', route);
                updateHeatmap(route);
            }
        });

    } catch (error) {
        console.error('Error finding route:', error);
        alert('Error finding route: ' + error.message);
    }
}

// Function to share route
function shareRoute() {
    if (!username) {
        alert('Please set your username first');
        return;
    }

    if (!routingControl) {
        alert('Please find a route first');
        return;
    }

    try {
        const sourceInput = document.getElementById('source').value;
        const destInput = document.getElementById('destination').value;
        const departureTime = document.getElementById('departure-time').value;
        const waypoints = routingControl.getWaypoints();
        
        // Save route to Firebase
        const routeData = {
            source: sourceInput,
            destination: destInput,
            departureTime: departureTime,
            waypoints: waypoints.map(wp => ({
                lat: wp.latLng.lat,
                lng: wp.latLng.lng
            })),
            timestamp: firebase.database.ServerValue.TIMESTAMP
        };

        routesRef.child(username).set(routeData);

        // Save route points for traffic prediction
        const router = routingControl.getRouter();
        if (router && router.route && router.route[0]) {
            const points = getRoutePoints(router.route[0]);
            
            points.forEach((point) => {
                trafficRef.push({
                    lat: point.lat,
                    lng: point.lng,
                    timestamp: point.timestamp,
                    username: username
                });
            });
        }

        alert('Route shared successfully!');
    } catch (error) {
        console.error('Error sharing route:', error);
        alert('Error sharing route: ' + error.message);
    }
}

// Function to get the user's current location
function getCurrentLocation() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(function(position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            // Remove existing marker if any
            if (currentLocationMarker) {
                map.removeLayer(currentLocationMarker);
            }
            
            // Add new marker
            currentLocationMarker = L.marker([lat, lng]).addTo(map);
            currentLocationMarker.bindPopup('Your Location').openPopup();
            
            // Center map on location
            map.setView([lat, lng], 13);
            
            // Update source input with coordinates
            document.getElementById('source').value = `${lat}, ${lng}`;
        }, function(error) {
            console.error('Error getting location:', error);
            alert('Unable to get your location. Please enter it manually.');
        });
    } else {
        alert('Geolocation is not supported by your browser');
    }
}

// Initialize the map with existing traffic data
trafficRef.once('value', (snapshot) => {
    const heatmapData = [];
    snapshot.forEach((childSnapshot) => {
        const data = childSnapshot.val();
        heatmapData.push([data.lat, data.lng, 1]);
    });
    
    if (heatmapData.length > 0) {
        heatmapLayer = L.heatLayer(heatmapData, {
            radius: 25,
            blur: 15,
            maxZoom: 10,
            max: 10,
            gradient: {0.4: 'blue', 0.6: 'yellow', 0.8: 'orange', 1: 'red'}
        }).addTo(map);
    }
});

// Function to display other users' routes
function displayUserRoute(userId, routeData) {
    // Remove existing route if any
    if (userRoutes[userId]) {
        map.removeControl(userRoutes[userId]);
    }

    // Create new route
    const control = L.Routing.control({
        waypoints: routeData.waypoints.map(wp => L.latLng(wp.lat, wp.lng)),
        show: false,
        addWaypoints: false,
        draggableWaypoints: false,
        lineOptions: {
            styles: [{ color: getRandomColor(), weight: 4 }]
        }
    }).addTo(map);

    userRoutes[userId] = control;

    // Update users list
    updateUsersList();
}

// Function to get random color for routes
function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// Function to update users list
function updateUsersList() {
    const usersList = document.getElementById('users-list');
    usersList.innerHTML = '';
    
    Object.keys(userRoutes).forEach(userId => {
        const div = document.createElement('div');
        div.className = 'user-route';
        div.textContent = `${userId}'s Route`;
        div.onclick = () => {
            const control = userRoutes[userId];
            const bounds = L.latLngBounds(control.getWaypoints().map(wp => wp.latLng));
            map.fitBounds(bounds);
        };
        usersList.appendChild(div);
    });
}

// Search functionality
function searchLocation(query) {
    // Using OpenStreetMap Nominatim API for geocoding
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => {
            if (data.length > 0) {
                const location = data[0];
                const lat = parseFloat(location.lat);
                const lng = parseFloat(location.lon);
                
                // Add marker for searched location
                L.marker([lat, lng])
                    .addTo(map)
                    .bindPopup(location.display_name)
                    .openPopup();
                
                // Center map on location
                map.setView([lat, lng], 13);
            } else {
                alert('Location not found');
            }
        })
        .catch(error => {
            alert('Error searching for location');
            console.error(error);
        });
}

// Listen for changes in routes
routesRef.on('child_added', snapshot => {
    const userId = snapshot.key;
    const routeData = snapshot.val();
    if (userId !== username) {
        displayUserRoute(userId, routeData);
    }
});

routesRef.on('child_changed', snapshot => {
    const userId = snapshot.key;
    const routeData = snapshot.val();
    if (userId !== username) {
        displayUserRoute(userId, routeData);
    }
});

routesRef.on('child_removed', snapshot => {
    const userId = snapshot.key;
    if (userRoutes[userId]) {
        map.removeControl(userRoutes[userId]);
        delete userRoutes[userId];
        updateUsersList();
    }
});

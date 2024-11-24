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

// Traffic intensity levels
const TRAFFIC_LEVELS = {
    VERY_LOW: { max: 0.2, color: '#00ff00', label: 'Very Light Traffic' },    // Green
    LOW: { max: 0.4, color: '#0000ff', label: 'Light Traffic' },             // Blue
    MODERATE: { max: 0.6, color: '#ffff00', label: 'Moderate Traffic' },     // Yellow
    HIGH: { max: 0.8, color: '#ffa500', label: 'Heavy Traffic' },            // Orange
    VERY_HIGH: { max: 1.0, color: '#ff0000', label: 'Severe Traffic' }       // Red
};

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
        gradient: Object.fromEntries(
            Object.entries(TRAFFIC_LEVELS).map(([_, data]) => [data.max, data.color])
        )
    }).addTo(map);
    
    // Add traffic legend
    addTrafficLegend().addTo(map);
    
    // Get user location
    getCurrentLocation();
    
    // Load initial traffic data
    loadTrafficData();
}

// Function to create traffic legend
function addTrafficLegend() {
    const legend = L.control({ position: 'bottomright' });
    
    legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'traffic-legend');
        div.style.backgroundColor = 'white';
        div.style.padding = '10px';
        div.style.borderRadius = '5px';
        div.style.border = '1px solid #ccc';
        
        let content = '<h4 style="margin: 0 0 5px 0">Traffic Conditions</h4>';
        
        Object.entries(TRAFFIC_LEVELS).forEach(([level, data]) => {
            content += `
                <div style="display: flex; align-items: center; margin: 5px 0;">
                    <div style="width: 20px; height: 20px; background-color: ${data.color}; margin-right: 5px;"></div>
                    <span>${data.label}</span>
                </div>
            `;
        });
        
        div.innerHTML = content;
        return div;
    };
    
    return legend;
}

// Function to load and display traffic data
async function loadTrafficData() {
    try {
        const snapshot = await trafficRef.once('value');
        const trafficData = snapshot.val() || {};
        
        const heatmapData = [];
        const currentTime = Date.now();
        const timeWindow = 30 * 60 * 1000; // 30 minutes
        
        Object.values(trafficData).forEach(point => {
            const timeDiff = Math.abs(point.timestamp - currentTime);
            if (timeDiff <= timeWindow) {
                heatmapData.push([point.lat, point.lng, 0.5]); // Default intensity
            }
        });
        
        if (heatmapData.length > 0) {
            heatmapLayer.setLatLngs(heatmapData);
        }
    } catch (error) {
        console.error('Error loading traffic data:', error);
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
        routingControl.on('routesfound', async function(e) {
            console.log('Route found:', e);
            const route = e.routes[0];
            
            // Generate route points
            const points = generateRoutePoints(route);
            console.log('Generated points:', points);
            
            // Save route points to Firebase
            await saveRoutePoints(points, departureTime);
            
            // Update traffic visualization
            await updateTrafficVisualization(points);
        });
        
    } catch (error) {
        console.error('Error finding route:', error);
        alert('Error finding route: ' + error.message);
    }
}

// Function to generate route points
function generateRoutePoints(route) {
    const points = [];
    const coordinates = route.coordinates;
    
    // Sample points along the route
    for (let i = 0; i < coordinates.length; i += Math.max(1, Math.floor(coordinates.length / 20))) {
        points.push({
            lat: coordinates[i].lat,
            lng: coordinates[i].lng
        });
    }
    
    return points;
}

// Function to save route points to Firebase
async function saveRoutePoints(points, departureTime) {
    if (!username) {
        alert('Please set your username first');
        return;
    }
    
    const departure = new Date(departureTime).getTime();
    const pointsWithTime = points.map((point, index) => ({
        ...point,
        timestamp: departure + (index * 300000), // 5 minutes between points
        username: username
    }));
    
    // Save each point to traffic_data
    for (const point of pointsWithTime) {
        await trafficRef.push(point);
    }
}

// Function to update traffic visualization
async function updateTrafficVisualization(routePoints) {
    try {
        const snapshot = await trafficRef.once('value');
        const trafficData = snapshot.val() || {};
        
        const heatmapData = [];
        const markers = [];
        
        // Process each route point
        for (const point of routePoints) {
            let nearbyPoints = 0;
            const timeWindow = 30 * 60 * 1000; // 30 minutes
            const searchRadius = 0.5; // 500m
            
            // Count nearby points
            Object.values(trafficData).forEach(data => {
                const distance = calculateDistance(
                    point.lat, point.lng,
                    data.lat, data.lng
                );
                
                if (distance <= searchRadius) {
                    nearbyPoints++;
                }
            });
            
            // Calculate intensity
            const intensity = Math.min(nearbyPoints / 10, 1);
            
            // Add to heatmap
            heatmapData.push([point.lat, point.lng, intensity]);
            
            // Add marker for significant traffic
            if (intensity >= 0.4) {
                const level = Object.entries(TRAFFIC_LEVELS)
                    .find(([_, data]) => intensity <= data.max)[0];
                const { color, label } = TRAFFIC_LEVELS[level];
                
                const marker = L.circleMarker([point.lat, point.lng], {
                    radius: 8,
                    fillColor: color,
                    color: '#000',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                });
                
                marker.bindPopup(`
                    <strong>${label}</strong><br>
                    Nearby Routes: ${nearbyPoints}<br>
                    Time: ${new Date(point.timestamp).toLocaleTimeString()}
                `);
                
                markers.push(marker);
            }
        }
        
        // Update heatmap
        if (heatmapLayer) {
            map.removeLayer(heatmapLayer);
        }
        
        heatmapLayer = L.heatLayer(heatmapData, {
            radius: 25,
            blur: 15,
            maxZoom: 10,
            max: 1.0,
            gradient: Object.fromEntries(
                Object.entries(TRAFFIC_LEVELS).map(([_, data]) => [data.max, data.color])
            )
        }).addTo(map);
        
        // Add markers
        const markerGroup = L.layerGroup(markers).addTo(map);
        
    } catch (error) {
        console.error('Error updating traffic visualization:', error);
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
            const points = generateRoutePoints(router.route[0]);
            
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

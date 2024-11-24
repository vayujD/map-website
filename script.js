// Initialize the map centered on a default location
let map = L.map('map').setView([0, 0], 2);

// Add the OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: ' OpenStreetMap contributors'
}).addTo(map);

// Variables to store the current state
let currentLocationMarker = null;
let routingControl = null;
let username = localStorage.getItem('username') || '';
let userRoutes = {};
let heatmapLayer = null;
let routePoints = [];

// Initialize Firebase references
const routesRef = firebase.database().ref('routes');
const trafficRef = firebase.database().ref('traffic_data');

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
    const coordinates = route.coordinates;
    
    for (let i = 0; i < coordinates.length; i++) {
        points.push({
            lat: coordinates[i].lat,
            lng: coordinates[i].lng,
            timestamp: estimateTimestamp(i, coordinates.length)
        });
    }
    
    return points;
}

// Function to estimate timestamp for each point based on position in route
function estimateTimestamp(pointIndex, totalPoints) {
    const departureTime = new Date(document.getElementById('departure-time').value).getTime();
    const averageSpeed = 50; // km/h
    const estimatedDuration = totalPoints * (3600 / averageSpeed); // seconds
    return departureTime + (pointIndex * (estimatedDuration / totalPoints) * 1000);
}

// Function to predict traffic intensity
function predictTrafficIntensity(point, timestamp) {
    return new Promise((resolve) => {
        const timeWindow = 30 * 60 * 1000; // 30 minutes window
        
        trafficRef.orderByChild('timestamp')
            .startAt(timestamp - timeWindow)
            .endAt(timestamp + timeWindow)
            .once('value', (snapshot) => {
                let intensity = 0;
                const nearbyPoints = [];
                
                snapshot.forEach((childSnapshot) => {
                    const data = childSnapshot.val();
                    const distance = calculateDistance(point, data);
                    
                    if (distance < 0.1) { // 100 meters radius
                        nearbyPoints.push(data);
                    }
                });
                
                intensity = nearbyPoints.length;
                resolve(intensity);
            });
    });
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
    const points = getRoutePoints(route);
    const heatmapData = [];
    
    for (const point of points) {
        const intensity = await predictTrafficIntensity(point, point.timestamp);
        if (intensity > 0) {
            heatmapData.push([point.lat, point.lng, intensity]);
        }
    }
    
    if (heatmapLayer) {
        map.removeLayer(heatmapLayer);
    }
    
    heatmapLayer = L.heatLayer(heatmapData, {
        radius: 25,
        blur: 15,
        maxZoom: 10,
        max: 10,
        gradient: {0.4: 'blue', 0.6: 'yellow', 0.8: 'orange', 1: 'red'}
    }).addTo(map);
}

// Function to find route between source and destination
async function findRoute() {
    try {
        const sourceInput = document.getElementById('source').value;
        const destInput = document.getElementById('destination').value;
        const departureTime = document.getElementById('departure-time').value;

        if (!sourceInput || !destInput || !departureTime) {
            alert('Please enter source, destination, and departure time');
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

        routingControl.on('routesfound', function(e) {
            const routes = e.routes;
            const route = routes[0];
            updateHeatmap(route);
        });

    } catch (error) {
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

    const sourceInput = document.getElementById('source').value;
    const destInput = document.getElementById('destination').value;
    const departureTime = document.getElementById('departure-time').value;
    const waypoints = routingControl.getWaypoints();
    
    // Save route to Firebase
    routesRef.child(username).set({
        source: sourceInput,
        destination: destInput,
        departureTime: departureTime,
        waypoints: waypoints.map(wp => ({
            lat: wp.latLng.lat,
            lng: wp.latLng.lng
        })),
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    // Save route points for traffic prediction
    const route = routingControl.getRouter().route[0];
    const points = getRoutePoints(route);
    
    points.forEach((point) => {
        trafficRef.push({
            lat: point.lat,
            lng: point.lng,
            timestamp: point.timestamp,
            username: username
        });
    });
}

// Function to get the user's current location
function getCurrentLocation() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(function(position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            if (currentLocationMarker) {
                map.removeLayer(currentLocationMarker);
            }
            
            currentLocationMarker = L.marker([lat, lng])
                .addTo(map)
                .bindPopup('You are here!')
                .openPopup();
            
            map.setView([lat, lng], 13);
            document.getElementById('source').value = `${lat}, ${lng}`;
        }, function(error) {
            alert("Error getting location: " + error.message);
        });
    } else {
        alert("Geolocation is not supported by your browser");
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
const searchInput = document.getElementById('search');
searchInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        const query = this.value;
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
});

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

// Initialize map and variables
let map;
let routingControl;
let currentLocationMarker = null;
let username = localStorage.getItem('username') || '';
let userRoutes = {};
let selectedPoint = null;
let selectedPointMarker = null;
let isSelectingPoint = false;

// Initialize Firebase references
const routesRef = firebase.database().ref('routes');

// Initialize map
function initMap() {
    map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: ' OpenStreetMap contributors'
    }).addTo(map);

    // Get user location
    getCurrentLocation();
    
    // Add map click handler
    map.on('click', onMapClick);
}

// Toggle point selection mode
function togglePointSelection() {
    isSelectingPoint = !isSelectingPoint;
    const btn = document.getElementById('select-point-btn');
    if (isSelectingPoint) {
        btn.textContent = 'Cancel Selection';
        btn.style.backgroundColor = '#dc3545';
        map.getContainer().style.cursor = 'crosshair';
    } else {
        btn.textContent = 'Select Point on Map';
        btn.style.backgroundColor = '#4CAF50';
        map.getContainer().style.cursor = '';
    }
}

// Handle map click for point selection
function onMapClick(e) {
    if (!isSelectingPoint) return;
    
    if (selectedPointMarker) {
        map.removeLayer(selectedPointMarker);
    }
    
    selectedPoint = e.latlng;
    selectedPointMarker = L.marker(selectedPoint).addTo(map);
    
    togglePointSelection();
}

// Check number of users passing through selected point
async function checkUsers() {
    if (!selectedPoint) {
        alert('Please select a point on the map first');
        return;
    }

    const checkTime = new Date(document.getElementById('check-time').value).getTime();
    if (!checkTime) {
        alert('Please select a time to check');
        return;
    }

    try {
        // Get routes within 30 minutes of check time
        const timeWindow = 30 * 60 * 1000; // 30 minutes in milliseconds
        
        routesRef.once('value', (snapshot) => {
            const routes = snapshot.val() || {};
            let usernames = new Set();

            Object.entries(routes).forEach(([key, route]) => {
                const routeTime = new Date(route.departureTime).getTime();
                if (Math.abs(routeTime - checkTime) <= timeWindow) {
                    route.points.forEach(point => {
                        const distance = getDistance(
                            selectedPoint.lat, 
                            selectedPoint.lng, 
                            point.lat, 
                            point.lng
                        );
                        if (distance <= 0.5) { // Within 500m
                            usernames.add(route.username);
                        }
                    });
                }
            });

            const userCount = usernames.size;
            
            // Update marker popup with user count
            if (selectedPointMarker) {
                map.removeLayer(selectedPointMarker);
            }
            
            selectedPointMarker = L.marker(selectedPoint)
                .bindPopup(
                    `<strong>Users passing through:</strong> ${userCount}<br>` +
                    `<strong>Time Window:</strong> ±30 minutes<br>` +
                    `<strong>Search Radius:</strong> 500m`
                )
                .addTo(map);
            
            selectedPointMarker.openPopup();

            if (userCount === 0) {
                alert('No users found passing through this point at the selected time');
            }
        });

    } catch (error) {
        console.error('Error checking users:', error);
        alert('Error checking users. Please try again.');
    }
}

// Calculate distance between two points in kilometers
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Get coordinates from location name
async function getCoordinates(locationName) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}`);
        const data = await response.json();
        
        if (data.length === 0) {
            throw new Error('Location not found');
        }
        
        return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon)
        };
    } catch (error) {
        console.error('Error getting coordinates:', error);
        throw error;
    }
}

// Find route between source and destination
async function findRoute() {
    const source = document.getElementById('source').value;
    const destination = document.getElementById('destination').value;
    
    if (!source || !destination) {
        alert('Please enter both source and destination');
        return;
    }

    try {
        const sourceCoords = await getCoordinates(source);
        const destCoords = await getCoordinates(destination);

        if (routingControl) {
            map.removeControl(routingControl);
        }

        routingControl = L.Routing.control({
            waypoints: [
                L.latLng(sourceCoords.lat, sourceCoords.lng),
                L.latLng(destCoords.lat, destCoords.lng)
            ],
            routeWhileDragging: true
        }).addTo(map);

    } catch (error) {
        alert('Error finding route. Please check your locations and try again.');
    }
}

// Share route with other users
function shareRoute() {
    if (!username) {
        alert('Please set your username first');
        return;
    }

    if (!routingControl || !routingControl._selectedRoute) {
        alert('Please find a route first');
        return;
    }

    const departureTime = document.getElementById('departure-time').value;
    if (!departureTime) {
        alert('Please select a departure time');
        return;
    }

    const route = routingControl._selectedRoute;
    const points = route.coordinates.map(coord => ({
        lat: coord.lat,
        lng: coord.lng
    }));

    const routeData = {
        username: username,
        departureTime: departureTime,
        points: points
    };

    const newRouteRef = routesRef.push();
    newRouteRef.set(routeData);
    alert('Route shared successfully!');
}

// Get current location
function getCurrentLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                
                if (currentLocationMarker) {
                    map.removeLayer(currentLocationMarker);
                }
                
                currentLocationMarker = L.marker([latitude, longitude])
                    .bindPopup('Your Location')
                    .addTo(map);
                
                map.setView([latitude, longitude], 13);
                
                document.getElementById('source').value = `${latitude}, ${longitude}`;
            },
            (error) => {
                console.error('Error getting location:', error);
                alert('Error getting your location. Please enter it manually.');
            }
        );
    } else {
        alert('Geolocation is not supported by your browser');
    }
}

// Set username
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

// Initialize map when page loads
document.addEventListener('DOMContentLoaded', initMap);

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

// Initialize Firebase references
const routesRef = firebase.database().ref('routes');

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

// Function to find route between source and destination
async function findRoute() {
    try {
        const sourceInput = document.getElementById('source').value;
        const destInput = document.getElementById('destination').value;

        if (!sourceInput || !destInput) {
            alert('Please enter both source and destination locations');
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
    const waypoints = routingControl.getWaypoints();
    
    // Save route to Firebase
    routesRef.child(username).set({
        source: sourceInput,
        destination: destInput,
        waypoints: waypoints.map(wp => ({
            lat: wp.latLng.lat,
            lng: wp.latLng.lng
        })),
        timestamp: firebase.database.ServerValue.TIMESTAMP
    });
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
            currentLocationMarker = L.marker([lat, lng])
                .addTo(map)
                .bindPopup('You are here!')
                .openPopup();
            
            // Center map on location
            map.setView([lat, lng], 13);

            // Set source input to current location coordinates
            document.getElementById('source').value = `${lat}, ${lng}`;
        }, function(error) {
            alert("Error getting location: " + error.message);
        });
    } else {
        alert("Geolocation is not supported by your browser");
    }
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

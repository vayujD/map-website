# Interactive Map with Real-time Route Sharing

A web application that allows users to find and share routes in real-time. Users can see each other's routes and interact with the map simultaneously.

## Features

- Interactive map with route planning
- Real-time route sharing between users
- Current location detection
- Location search functionality
- User route history
- Responsive design

## Setup

1. Create a Firebase project:
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project
   - Enable Realtime Database
   - Copy your Firebase configuration

2. Update Firebase configuration:
   - Open `firebase-config.js`
   - Replace the placeholder values with your Firebase configuration

3. Deploy to GitHub Pages:
   - Create a new GitHub repository
   - Push the code to the repository
   - Enable GitHub Pages in the repository settings
   - Your site will be available at `https://[username].github.io/[repository-name]`

## Local Development

1. Clone the repository
2. Update Firebase configuration in `firebase-config.js`
3. Serve the files using a local server:
   ```bash
   python -m http.server 8000
   ```
4. Open `http://localhost:8000` in your browser

## Usage

1. Enter your name and click "Set Name"
2. Enter source and destination locations
3. Click "Find Route" to calculate the route
4. Click "Share Route" to make it visible to other users
5. View other users' routes in the sidebar
6. Click on a user's route to focus on it

## Technologies Used

- HTML5
- CSS3
- JavaScript
- Leaflet.js for mapping
- Firebase Realtime Database for real-time updates
- OpenStreetMap for map tiles
- Leaflet Routing Machine for route calculation

## License

MIT License

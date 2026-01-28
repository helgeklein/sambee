# Documentation

This is a collection of points and ideas for a future end-user facing documentation.

## Features

- Fast & modern UI
   - Works on all screen sizes and device types
   - Excellent keyboard navigation
   - Fantastic UX on mobile platforms
   - PWA: add the app icon to the home screen for near-native app UX
   - Themes: adjust the style and appearance of the UI
- File listing
   - Automatic refresh when a directory on the SMB share is updated
   - Smooth scrolling even through very large directories
- Image viewer
   - Supports a great range of image types, including PSD, HEIF, EPS
   - Automatic CMYK→RGB color conversion
   - Superfast viewing & browsing with smooth animations
- PDF viewer
   - Search functionality
   - PDF normalization with Ghostscript for maximum compatibility
- Markdown viewer
- Backend
   - SMB protocol support optimized for speed
- Deployment
   - Single Docker container
- Operations & maintenance
   - Great logging
   - Frontend logs can be collected by the backend for easier analysis
- Efficiency
   - Low resource requirements on the server
   - No thumbnail generation, everything happens on the fly
- Designed to work with a reverse proxy for speed and security (HTTPS)
   - E.g., Caddy, nginx, Traefik
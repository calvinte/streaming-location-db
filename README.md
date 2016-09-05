Streaming Location DB
=====================

Application accepts WebSocket connections, transforms streaming data to an
optimized bezier curve, stored as SVG (see directory `.svg_db`). Geolocation
data for non-redundent coordinates (SVG anchors) are persisted in Postgres.

Postgres
--------
```
// CREATE DATABASE streaming_location_svg;
// \c streaming_location_svg;
// CREATE EXTENSION Postgis;
// CREATE EXTENSION "uuid-ossp";
```

Terminal
--------
```
git clone git@github.com:calvintennant/streaming-location-db.git
cd streaming-location-db
npm install
mocha spec/runner.js
```


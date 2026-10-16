
 //LEAFLET MAP
var map = L.map('map').setView([51.505, -0.09], 13);
        
L.tileLayer('https://api.maptiler.com/maps/outdoor-v4/{z}/{x}/{y}.png?key=RYHVbyF322OxTHbWxkAi',
    {attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>'}
).addTo(map);


navigator.geolocation.getCurrentPosition(success, error);

let currentLoc, circle, zoomLevel;

function success(pos){
    const lat = pos.coords.latitude;
    const long = pos.coords.longitude;
    const acc = pos.coords.accuracy;

    // one markers only
   if (currentLoc) {
        map.removeLayer(currentLoc);
    }

    

    //set the loc marker and circle
    currentLoc = L.marker([lat,long], {draggable: true})
        .addTo(map)
        .bindPopup(`You are here! (Accurate to ${Math.round(acc)}m)`)
        .openPopup();
    
    //goto the user coords coords
    map.setView([lat, long], 16);

    circle = L.circle([lat,long], {radius: acc}).addTo(map);
    
    //after dragging the loc marker
    currentLoc.on('dragend', function () {
        const position = currentLoc.getLatLng();
        const newLat = position.lat;
        const newLong = position.lng;

        currentLoc.bindPopup(
            "Moved to: " + newLat.toFixed(5) + ", " + newLong.toFixed(5)
        ).openPopup();

         //UPDATEEEEEEEE GEEE
        updateGEECoordinates();
        
    });
    //circle follow the marker when dragging
    currentLoc.on('drag', function () {
        circle.setLatLng(currentLoc.getLatLng());
    });
    
    //doesnt change zoom
    if(!zoomLevel){
        zoomLevel = map.fitBounds(circle.getBounds());
    }

   
}

function error(err) {
    if(err.code === 1){
        alert("Please allow geolocation access.")
    } else {
        alert("Cannot get location.")
    }
}



//GEE

const GEE_API = "http://127.0.0.1:5000/analyze";

let geeTileLayer = null;
let geeLastResult = null;

let geeLocation = document.getElementById("gee-location");
let geeStart = document.getElementById("gee-start");
let geeEnd = document.getElementById("gee-end");
const geeAnalyze = document.getElementById("gee-analyze");
let geeStatus = document.getElementById("gee-status");
let geeResults = document.getElementById("gee-results");

// Display the marker's current coordinates.
function updateGEECoordinates() {
  const position = currentLoc.getLatLng();

  geeLocation = document.getElementById("gee-location");
  geeLocation.textContent = `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`;
}



// Request Landsat analysis from the Flask backend.
async function analyzeGEE() {
    

  if (!currentLoc) {
    geeStatus.textContent = "Waiting for your location. Allow location access first.";
    return;
  }

  const position = currentLoc.getLatLng();

  geeAnalyze.disabled = true;
  geeStatus.textContent = "Searching Landsat scenes...";
  geeResults.replaceChildren();

  try {
    const response = await fetch(GEE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        latitude: position.lat,
        longitude: position.lng,
        start_date: geeStart.value || undefined,
        end_date: geeEnd.value || undefined
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Analysis failed.");
    }

    geeLastResult = result;
    displayGEEResults(result);
    displayIndexPreviews(result.previews);
    showGEELayer("true_color");

    geeStatus.textContent =
      `Analysis complete: ${result.date} (${result.spacecraft || "Landsat"})`;

  } catch (error) {
    console.error("Earth Engine error:", error);
    geeStatus.textContent = `Error: ${error.message}`;
  } finally {
    geeAnalyze.disabled = false;
  }
}

// Display the satellite pixel values.
function displayGEEResults(result) {
  geeResults.replaceChildren();

  const heading = document.createElement("h3");
  heading.textContent = "Pixel Values";
  geeResults.appendChild(heading);

  const details = [
    ["Scene cloud cover", result.cloud_cover == null
      ? "Unknown"
      : `${result.cloud_cover}%`],
    ["Scenes found", result.scenes_found],
    ["Pixel scale", `${result.pixel_scale_m} m`]
  ];

  for (const [label, value] of details) {
    const p = document.createElement("p");
    p.textContent = `${label}: ${value}`;
    geeResults.appendChild(p);
  }

  const table = document.createElement("table");
  const body = document.createElement("tbody");

  for (const [name, value] of Object.entries(result.values || {})) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const valueCell = document.createElement("td");

    nameCell.textContent = name;
    valueCell.textContent =
      value == null ? "No data" :
      typeof value === "number" ? value.toFixed(4) :
      String(value);

    row.append(nameCell, valueCell);
    body.appendChild(row);
  }

  table.appendChild(body);
  geeResults.appendChild(table);
}

// Display the selected Earth Engine tile layer.
function showGEELayer(layer) {
    if (!geeLastResult || !geeLastResult.tiles[layer]) {
        console.error("Layer not found:", layer);
        return;
    }

    const tileUrl = geeLastResult.tiles[layer];

    if (geeTileLayer) {
        map.removeLayer(geeTileLayer);
    }

    geeTileLayer = L.tileLayer(tileUrl, {
        opacity: 0.8,
        maxZoom: 18,
        attribution: "Google Earth Engine / USGS Landsat"
    }).addTo(map);
}

geeAnalyze.addEventListener("click", analyzeGEE);


//display previews
function displayIndexPreviews(previews) {
    // Landsat previews
    document.getElementById("preview-landsat-ndvi").src =
        previews.landsat.ndvi;

    document.getElementById("preview-landsat-ndwi").src =
        previews.landsat.ndwi;

    document.getElementById("preview-landsat-gci").src =
        previews.landsat.gci;

    document.getElementById("preview-landsat-lst").src =
        previews.landsat.lst;

    // Sentinel-2 previews
    const sentinel = previews.sentinel || {};

    document.getElementById("preview-sentinel-ndvi").src =
        sentinel.ndvi || "";

    document.getElementById("preview-sentinel-ndwi").src =
        sentinel.ndwi || "";

    document.getElementById("preview-sentinel-gci").src =
        sentinel.gci || "";
    
    document.getElementById("preview-sentinel-evi2").src =
        previews.sentinel?.evi2 || "";
    
}

//tapping images to change map layer

document.querySelectorAll(".layer-preview").forEach((image) => {
    image.addEventListener("click", () => {
        showGEELayer(image.dataset.layer);
    });
});

//LEAFLET MAP
var map = L.map('map').setView([51.505, -0.09], 13);
        
L.tileLayer('https://api.maptiler.com/maps/outdoor-v4/{z}/{x}/{y}.png?key=RYHVbyF322OxTHbWxkAi',
    {attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>'}
).addTo(map);


navigator.geolocation.getCurrentPosition(success, error);

let currentLoc, circle, zoomLevel;
let long, lat;
let farmrange = document.getElementById("farmrange")

function updateCircle(latv, longv, rad) {
    if (circle){map.removeLayer(circle);}
    //no dupes circle
    circle = L.circle([lat,long
    ], {radius: farmrange.value}).addTo(map);
}
function success(pos){
    lat = pos.coords.latitude;
    long = pos.coords.longitude;
    const acc = pos.coords.accuracy;
    const latInput = document.getElementById("lat");
    const longInput = document.getElementById("long");

    latInput.value = lat.toFixed(5)
    longInput.value = long.toFixed(5)

    // one markers only
   if (currentLoc) {
        map.removeLayer(currentLoc);
    }
    //add circle
    updateCircle(lat, long, farmrange.value);   // FIX: was "updateCircle;" (never called, so circle was undefined)

    //set the loc marker and circle
    currentLoc = L.marker([lat,long], {draggable: true})
        .addTo(map)
        .bindPopup(`You are here! (Accurate to ${Math.round(acc)}m)`)
        .openPopup();
    
    //goto the user coords coords
    map.setView([lat, long], 16);

    
    
    //after dragging the loc marker
    currentLoc.on('dragend', function () {
        currentLoc.bindPopup(
            "Moved"
        ).openPopup();
        
    });
    //circle follow the marker when dragging
    currentLoc.on('drag', function () {
        circle.setLatLng(currentLoc.getLatLng());
        
        const position = currentLoc.getLatLng();
        lat = position.lat;
        long = position.lng;
        //change lat ang long values 
        latInput.value = position.lat.toFixed(5)
        longInput.value = position.lng.toFixed(5)


        updateCircle(position.lat,position.lng, farmrange.value);
        //circle = L.circle([position.lat,position.lng], {radius: farmrange.value}).addTo(map);



    });

     // every change of range val
    farmrange.addEventListener('input', function(event) {
        // Access the current value using event.target.value
        let rangevalue = document.getElementById("rangevalue");
        rangevalue.textContent = event.target.value + " m";

        updateCircle(lat, long, farmrange.value);
        
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
//let geeResults = document.getElementById("gee-results");


/* ============================================================
   DESIGN LAYER: loading screen + home/results views
   (no change to the analysis logic)
   ============================================================ */
const loadingScreen = document.getElementById("loading-screen");
const loadingStatus = document.getElementById("loading-status");

const LOADING_MESSAGES = [
  "Contacting satellites",
  "Searching Landsat 8 and 9 scenes",
  "Searching Sentinel-2 scenes",
  "Checking MODIS evapotranspiration",
  "Rendering index maps"
];
const MIN_LOADING_MS = 2500;   // keep the scan on screen long enough to feel intentional
let loadingTimer = null;

// twinkling stars for the loading screen
(function makeStars() {
  const box = document.getElementById("ld-stars");
  for (let i = 0; i < 70; i++) {
    const s = document.createElement("span");
    const size = Math.random() * 2.2 + 0.8;
    s.className = "ld-star";
    s.style.width = s.style.height = `${size}px`;
    s.style.left = `${Math.random() * 100}%`;
    s.style.top = `${Math.random() * 70}%`;
    s.style.animationDelay = `${Math.random() * 3}s`;
    s.style.animationDuration = `${2 + Math.random() * 3}s`;
    box.appendChild(s);
  }
})();

function showLoading() {
  let i = 0;
  loadingStatus.textContent = LOADING_MESSAGES[0];
  loadingScreen.classList.add("show");
  loadingScreen.setAttribute("aria-hidden", "false");
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    i = Math.min(i + 1, LOADING_MESSAGES.length - 1);
    loadingStatus.textContent = LOADING_MESSAGES[i];
  }, 2200);
}

function hideLoading() {
  clearInterval(loadingTimer);
  loadingScreen.classList.remove("show");
  loadingScreen.setAttribute("aria-hidden", "true");
}

// Leaflet must be told when its container changes size.
function refreshMap() {
  setTimeout(() => {
    map.invalidateSize();
    if (currentLoc) map.setView(currentLoc.getLatLng(), map.getZoom());
  }, 150);
}

function showResultsPage() {
  document.body.classList.replace("view-home", "view-results");
  window.scrollTo(0, 0);
  refreshMap();
}

function showHomePage() {
  document.body.classList.replace("view-results", "view-home");
  window.scrollTo(0, 0);
  refreshMap();
}

document.getElementById("back-home").addEventListener("click", showHomePage);


// Request Landsat analysis from the Flask backend.
async function analyzeGEE() {
    

  if (!currentLoc) {
    geeStatus.textContent = "Waiting for your location. Allow location access first.";
    return;
  }

  const position = currentLoc.getLatLng();

  geeAnalyze.disabled = true;
  geeStatus.textContent = "Searching Landsat 8, Landsat 9, and Sentinel-2 scenes...";
//  geeResults.replaceChildren();

  const startedAt = Date.now();
  showLoading();

  try {
    const response = await fetch(GEE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        latitude: position.lat,
        longitude: position.lng,
        range: farmrange.value,
        start_date: geeStart.value || undefined,
        end_date: geeEnd.value || undefined
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Analysis failed.");
    }

    geeLastResult = result;
    //displayGEEResults(result);
    displayIndexPreviews(result.previews);
    showGEELayer("true_color");

    geeStatus.textContent =
      `Analysis complete: ${result.date} (${result.spacecraft || "Landsat"})`;

    const wait = MIN_LOADING_MS - (Date.now() - startedAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    showResultsPage();

  } catch (error) {
    console.error("Earth Engine error:", error);
    geeStatus.textContent = `Error: ${error.message}`;
  } finally {
    hideLoading();
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
    ["Landsat Scenes found", result.landsat_scenes_found],
     ["Sentinel Scenes found", result.sentinel2_scenes_found],
      ["Modis Scenes found", result.modis_scenes_found],
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
        console.log("Available layers:", geeLastResult?.tiles);
        return;
    }

    const tileUrl = geeLastResult.tiles[layer];

    if (geeTileLayer) {
        map.removeLayer(geeTileLayer);
    }

    geeTileLayer = L.tileLayer(tileUrl, {
        opacity: 0.8,
        maxZoom: 18,
        attribution: "Google Earth Engine / USGS Landsat 8 and 9 and Sentinel-2"
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
    

    //modis
    // Sentinel-2 previews
    const modis = previews.modis || {};

    document.getElementById("preview-modis-et").src =
        previews.modis?.et || "";
        
    document.getElementById("preview-modis-pet").src =
        previews.modis?.pet || "";
}

//tapping images to change map layer

document.querySelectorAll(".layer-preview").forEach((image) => {
    image.addEventListener("click", () => {
        showGEELayer(image.dataset.layer);
        // bring the giant map back into view so the overlay is visible
        document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" });
    });
});
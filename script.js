 var map = L.map('map').setView([51.505, -0.09], 13);
        
L.tileLayer('https://api.maptiler.com/maps/outdoor-v4/{z}/{x}/{y}.png?key=RYHVbyF322OxTHbWxkAi',
    {attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>'}
).addTo(map);


navigator.geolocation.getCurrentPosition(success, error);

let currrentLoc, circle, zoomLevel;

function success(pos){
    const lat = pos.coords.latitude;
    const long = pos.coords.longitude;
    const acc = pos.coords.accuracy;
    console.log(`Lat: ${lat}, Long: ${long}, Accurate within ${acc} meters.`);

    // one markers only
    if(currrentLoc){
        map.removeLayer('currentLoc');
    }

    //set the loc marker and circle
    currentLoc = L.marker([lat,long], {draggable: true})
        .addTo(map)
        .bindPopup(`You are here! (Accurate to ${Math.round(acc)}m)`)
        .openPopup();
        circle = L.circle([lat,long], {radius: acc}).addTo(map);
    
    //after dragging the loc marker
    currentLoc.on('dragend', function (event){
        const position = currentLoc.getLatLng();
        const newLat = position.lat;
        const newLong = position.lng;
        
        currentLoc.bindPopup("Moved to:" + newLat.toFixed(5) + ", " + newLong.toFixed(5)).openPopup();
        
    })

    //circle follow the marker when dragging
    currentLoc.on('drag', function () {
        circle.setLatLng(currentLoc.getLatLng());
    });
    
    //doesnt change zoom
    if(!zoomLevel){
        zoomLevel = map.fitBounds(circle.getBounds());
    }

    //goto the user coords coords
        map.setView([lat, long]);

}

function error(err) {
    if(err.code === 1){
        alert("Please allow geolocation access.")
    } else {
        alert("Cannot get location.")
    }
}

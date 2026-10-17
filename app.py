


from datetime import date, timedelta

import ee
from flask import Flask, jsonify, request
from flask_cors import CORS

EE_PROJECT = "whatever-511808"

ee.Initialize(project=EE_PROJECT)

app = Flask(__name__)
CORS(app)


def mask_clouds(image):
    image = ee.Image(image)

    qa = image.select("QA_PIXEL")
    mask = qa.bitwiseAnd(63).eq(0)
    mask = mask.And(image.select("QA_RADSAT").eq(0))

    return ee.Image(image.updateMask(mask))


def prepare_landsat(image):
    image = ee.Image(image)
    image = mask_clouds(image)

    optical = ee.Image(
        image.select(
            ["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"],
            ["blue", "green", "red", "nir", "swir1", "swir2"]
        ).multiply(0.0000275).add(-0.2)
    )

    ndvi = optical.normalizedDifference(
        ["nir", "red"]
    ).rename("NDVI")

    ndwi = optical.normalizedDifference(
        ["nir", "swir1"]
    ).rename("NDWI")

    gci = (
        optical.select("nir")
        .divide(optical.select("green"))
        .subtract(1)
        .rename("GCI")
    )

    lst = (
        image.select("ST_B10")
        .multiply(0.00341802)
        .add(149)
        .subtract(273.15)
        .rename("LST_C")
    )

    return ee.Image(
        optical.addBands([ndvi, ndwi, gci, lst])
        .copyProperties(image, image.propertyNames())
    )


def make_tile_url(image, vis_params):
    map_id = image.getMapId(vis_params)
    return map_id["tile_fetcher"].url_format


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json(silent=True) or {}

    try:

        lat = float(data["latitude"])
        lon = float(data["longitude"])



        point = ee.Geometry.Point([lon, lat])
        square = point.buffer(100).bounds()

        vis = {
            "ndvi": {"min": 0.0, "max": 0.7, "palette": ["#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850"]},
            "gci": {"min": 0, "max": 0.5, "palette": ["#77157e", "#873c86", "#a66da7", "#c4a0c5", "#dcdcdb", "#b5d0a9", "#7dbb70", "#46a83c", "#0d8b14"]},
            "ndwi": {"min": 0, "max": 0.2, "palette": ["#e53935", "#ffeb3b", "#055a93"]},
            "lst": { "min": 20, "max": 35, "palette": ["#313695", "#74add1", "#ffffbf", "#f46d43", "#a50026"]},
            "evi2": { "min": 0.0, "max": 0.8,"palette":  ["#d73027", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#d9ef8b", "#a6d96a", "#66bd63", "#1a9850"]}
        }


        if not (-90 <= lat <= 90):
            raise ValueError("Latitude must be between -90 and 90.")

        if not (-180 <= lon <= 180):
            raise ValueError("Longitude must be between -180 and 180.")

        end_date = data.get("end_date") or date.today().isoformat()
        start_date = data.get("start_date") or (
            date.today() - timedelta(days=730)
        ).isoformat()

        # Validate date strings and order.
        date.fromisoformat(start_date)
        date.fromisoformat(end_date)

        if start_date >= end_date:
            raise ValueError(
                "End date must be later than start date."
           )

    except (KeyError, TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400

    point = ee.Geometry.Point([lon, lat])

    landsat8 = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    landsat9 = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")

    collection = (
        landsat8.merge(landsat9)
        .filterBounds(point)
        .filterDate(start_date, end_date)
        .filter(ee.Filter.gte("CLOUD_COVER", 0))
        .filter(ee.Filter.lt("CLOUD_COVER", 20))
        .filter(ee.Filter.gt("SUN_ELEVATION", 0))
        .filter(ee.Filter.eq("PROCESSING_LEVEL", "L2SP"))
        .sort("CLOUD_COVER")
    )

    #SENTINEL IMAGES
    sentinel = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(point)
        .filterDate(start_date, end_date)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
        .sort("CLOUDY_PIXEL_PERCENTAGE")
    )

    try: 
        
        sentinel_count = sentinel.size().getInfo()

        if sentinel_count > 0:
            s2_image = ee.Image(sentinel.first())

            # Convert surface reflectance to reflectance values
            s2 = s2_image.select(
                ["B3", "B4", "B8", "B11"],
                ["green", "red", "nir", "swir1"]
            ).multiply(0.0001)

            s2_ndvi = s2.normalizedDifference(
                ["nir", "red"]
            ).rename("NDVI")

            s2_gci = (
                s2.select("nir")
                .divide(s2.select("green"))
                .subtract(1)
                .rename("GCI")
            )

            s2_ndmi = s2.normalizedDifference(
                ["nir", "swir1"]
            ).rename("NDMI")

            s2_evi2 = (
                s2.select("nir").subtract(s2.select("red"))
                .multiply(2.5)
                .divide(
                    s2.select("nir")
                    .add(s2.select("red").multiply(2.4))
                    .add(1)
                )
                .rename("EVI2")
            )

  
        scene_count = collection.size().getInfo()

        if scene_count == 0:
            return jsonify({
                "error": "No daytime Landsat scenes with less than 20% cloud cover and available surface temperature data were found for this location and date range. Try expanding the date range."
            }), 404

        scene = ee.Image(collection.first())
        prepared = prepare_landsat(scene)

        preview_images = {
            "landsat": {
                "ndvi": prepared.select("NDVI").getThumbURL({
                    **vis["ndvi"],
                    "region": square,
                    "dimensions": "256x256",
                    "format": "png"
                }),
                "gci": prepared.select("GCI").getThumbURL({
                    **vis["gci"],
                    "region": square,
                    "dimensions": "256x256",
                    "format": "png"
                }),
                "ndwi": prepared.select("NDWI").getThumbURL({
                    **vis["ndwi"],
                    "region": square,
                    "dimensions": "256x256",
                    "format": "png"
                }),
                "lst": prepared.select("LST_C").getThumbURL({
                    **vis["lst"],
                    "region": square,
                    "dimensions": "256x256",
                    "format": "png"
                }),
            },
            "sentinel": {}
        }

        # Generate Sentinel-2 previews only if scenes are available
        if sentinel_count > 0:
            preview_images["sentinel"] = {
                "ndvi": s2_ndvi.getThumbURL({
                    **vis["ndvi"],
                    "region": square,
                    "dimensions": "256x256",
                    "format": "png"
                }),
                "gci": s2_gci.getThumbURL({
                    **vis["gci"],
                    "region": square,
                    "dimensions": "256x256",
                    "format": "png"
                }),
                "ndwi": s2_ndmi.getThumbURL({
                    **vis["ndwi"],
                    "region": square,
                    "dimensions": "256x256",
                    "format": "png"
                }),
                "evi2": s2_evi2.getThumbURL({
                    **vis["evi2"],
                    "region": square,
                    "dimensions": "256x256",
                    "format": "png"
                }),
            }


        prepared_image = ee.Image(prepared)

        values = prepared_image.reduceRegion(
            reducer=ee.Reducer.first(),
            geometry=point,
            scale=30,
            maxPixels=1000000
        ).getInfo()

        metadata = scene.toDictionary([
            "system:time_start",
            "SPACECRAFT_ID",
            "CLOUD_COVER",
        ]).getInfo()

        raw_bands = ee.Image(scene).select(
            ["SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7"],
            [
                "DN_B2_blue", "DN_B3_green", "DN_B4_red",
                "DN_B5_nir", "DN_B6_swir1", "DN_B7_swir2",
            ],
        )

        raw_values = raw_bands.reduceRegion(
            reducer=ee.Reducer.first(),
            geometry=point,
            scale=30,
            maxPixels=1000000,
        ).getInfo()

        values = {**(raw_values or {}), **(values or {})}
   
        tiles = {
            "true_color": make_tile_url(
                scene,
                {
                    "bands": ["SR_B4", "SR_B3", "SR_B2"],
                    "min": 7000,
                    "max": 18000,
                },
            ),
            "ndvi": make_tile_url(prepared.select("NDVI"), vis["ndvi"]),
            "gci": make_tile_url(prepared.select("GCI"), vis["gci"]),
            "ndwi": make_tile_url(prepared.select("NDWI"), vis["ndwi"]),
            "lst": make_tile_url(prepared.select("LST_C"), vis["lst"])
        }

        if sentinel_count > 0:
            tiles.update({
                "sentinel_ndvi": make_tile_url(s2_ndvi, vis["ndvi"]),
                "sentinel_gci": make_tile_url(s2_gci, vis["gci"]),
                "sentinel_ndwi": make_tile_url(s2_ndmi, vis["ndwi"]),
               "sentinel_evi2": make_tile_url(s2_evi2, vis["evi2"])
            })

        result = {
            "latitude": lat,
            "longitude": lon,
            "date": date.fromtimestamp(
                metadata["system:time_start"] / 1000
            ).isoformat(),
            "spacecraft": metadata.get("SPACECRAFT_ID"),
            "cloud_cover": metadata.get("CLOUD_COVER"),
            "scenes_found": scene_count,
            "pixel_scale_m": 30,
            "values": values,
            "previews": preview_images,
            "tiles": tiles,
        }


        return jsonify(result)

    except Exception as exc:
        app.logger.exception("Earth Engine analysis failed")
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)

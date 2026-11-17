# Return the address for a set of latitude/longitude coordinates (reverse geocoding)

**Reverse geocoding** is the process of converting geographic coordinates
(latitude and longitude) into a human-readable address using the
`google.maps.Geocoder` class in the Maps JavaScript API.

> **Prerequisite**: Before using the Geocoding service in the Maps JavaScript
> API, ensure that the **Geocoding API** is enabled in the Google Cloud console
> in the same project set up for your Maps JavaScript API key.

--------------------------------------------------------------------------------

## Workflow: Reverse Geocode Coordinates

To reverse geocode a set of coordinates:

1.  **Import Required Libraries**: Load the `geocoding` library via
    `google.maps.importLibrary('geocoding')` (along with `maps` and `marker` if
    rendering on a map).
2.  **Instantiate Geocoder**: Create an instance of `google.maps.Geocoder`.
3.  **Construct the Request**: Create a `GeocoderRequest` object literal passing
    a `google.maps.LatLng` or `google.maps.LatLngLiteral` (`{ lat: number, lng:
    number }`) to the `location` property.
    *   **Important**: Do **not** include the `componentRestrictions` parameter
        in a reverse geocoding request; if you include `componentRestrictions`,
        the `location` parameter is ignored.
4.  **Execute & Handle Response**: Call `geocoder.geocode(request)` and `await`
    the returned Promise. Extract `results` from the response.
    *   `results` are ordered from best (most exact, such as a street address)
        to least specific (such as neighborhood, city, county, or state).

--------------------------------------------------------------------------------

## Complete Example: Reverse Geocoding with Map & InfoWindow

The following example demonstrates reverse geocoding coordinates from an input
field or a map click, placing an `AdvancedMarkerElement`, and displaying the
`formatted_address` in an `InfoWindow`.

### HTML

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Reverse Geocoding</title>
    <link rel="stylesheet" type="text/css" href="./style.css" />
    <script type="module" src="./index.js"></script>
    <script>
      (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
        key: "GOOGLE_MAPS_API_KEY"
      });
    </script>
  </head>
  <body>
    <gmp-map
      center="40.714224, -73.961452"
      zoom="8"
      map-id="DEMO_MAP_ID"
      internal-usage-attribution-ids="gmp_git_agentskills_v1">
      <div id="floating-panel" slot="control-block-start-inline-start">
        <p>Click the map to reverse geocode, or add your own coordinates.</p>
        <input id="latlng" type="text" value="40.714224, -73.961452" /><br />
        <input id="submit" type="button" value="Reverse Geocode" />
      </div>
    </gmp-map>
  </body>
</html>
```

### TypeScript / JavaScript

```typescript
let marker: google.maps.marker.AdvancedMarkerElement;

async function init() {
  // Request the needed libraries.
  const [{ InfoWindow }, { Geocoder }, { AdvancedMarkerElement }] =
    await Promise.all([
      google.maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
      google.maps.importLibrary('geocoding') as Promise<google.maps.GeocodingLibrary>,
      google.maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
    ]);

  // Get the gmp-map element and innerMap.
  const mapElement = document.querySelector('gmp-map') as google.maps.MapElement;
  const innerMap = mapElement.innerMap;

  const latLngQuery = document.getElementById('latlng') as HTMLInputElement;
  const submitButton = document.getElementById('submit')!;

  innerMap.setOptions({
    draggableCursor: 'crosshair',
    zoom: 13,
    mapTypeControl: false,
    internalUsageAttributionIds: ['gmp_git_agentskills_v1'],
  });

  // Create a marker for re-use.
  marker = new AdvancedMarkerElement({
    map: innerMap,
  });

  const geocoder = new Geocoder();
  const infoWindow = new InfoWindow();

  // Add a click event listener to the submit button.
  submitButton.addEventListener('click', () => {
    void geocodeLatLng(geocoder, innerMap, infoWindow);
  });

  // Add a click event listener to the map.
  innerMap.addListener('click', (event: google.maps.MapMouseEvent) => {
    if (event.latLng) {
      latLngQuery.value = `${event.latLng.lat()}, ${event.latLng.lng()}`;
      void geocodeLatLng(geocoder, innerMap, infoWindow);
    }
  });

  // Make an initial request upon loading.
  void geocodeLatLng(geocoder, innerMap, infoWindow);
}

async function geocodeLatLng(
  geocoder: google.maps.Geocoder,
  map: google.maps.Map,
  infoWindow: google.maps.InfoWindow
) {
  const input = (document.getElementById('latlng') as HTMLInputElement).value;
  const latlngStr = input.split(',', 2);
  const latlng: google.maps.LatLngLiteral = {
    lat: parseFloat(latlngStr[0]),
    lng: parseFloat(latlngStr[1]),
  };

  try {
    const { results } = await geocoder.geocode({ location: latlng });

    if (results[0]) {
      marker.position = latlng;
      map.setCenter(latlng);
      infoWindow.setContent(results[0].formatted_address);
      infoWindow.open(map, marker);
    } else {
      window.alert('No results found');
    }
  } catch (e) {
    window.alert('Geocoder failed due to: ' + String(e));
  }
}

void init();
```

### CSS

```css
gmp-map {
  height: 100%;
}

html,
body {
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: Roboto, sans-serif;
}

#floating-panel {
  background-color: #fff;
  border-radius: 5px;
  box-shadow: rgba(0, 0, 0, 0.35) 0px 5px 15px;
  margin: 10px;
  padding: 10px;
  font-size: 1rem;
}

#latlng {
  width: 100%;
  font-size: 1rem;
  margin-bottom: 4px;
}
```

--------------------------------------------------------------------------------

## Understanding Reverse Geocoding Responses

### Result Ordering and Filtering by Type

The reverse geocoder returns multiple `GeocoderResult` objects in `results[]`,
ordered from most specific (such as `street_address`) to broader political
entities (`neighborhood`, `locality`, `administrative_area_level_2`,
`administrative_area_level_1`, `country`).

For example, a single coordinate lookup in Brooklyn, NY may return:

```text
results[0].formatted_address: "277 Bedford Ave, Brooklyn, NY 11211, USA" (street_address)
results[1].formatted_address: "Grand St/Bedford Av, Brooklyn, NY 11211, USA" (intersection)
results[2].formatted_address: "Williamsburg, Brooklyn, NY, USA" (neighborhood)
results[3].formatted_address: "Brooklyn, NY, USA" (sublocality)
results[4].formatted_address: "New York, NY, USA" (locality)
```

*   **Do not parse `formatted_address` programmatically.** Instead, inspect
    `results[].types` to find a specific granularity (e.g., `locality` for city
    level) or iterate through `results[0].address_components[]` to extract
    individual fields (`long_name`, `short_name`, and `types[]`).

### Advanced Options

#### 1. Fulfill on Zero Results (`fulfillOnZeroResults`)

By default, `geocoder.geocode()` rejects its Promise when `status` is
`ZERO_RESULTS` (e.g., remote coordinates in Antarctica or oceans). However,
response-level fields like `plus_code` and `address_descriptor` may still be
populated. Set `fulfillOnZeroResults: true` to resolve the Promise on
`ZERO_RESULTS`:

```javascript
async function reverseGeocodeWithPlusCode(geocoder) {
  const latlng = { lat: -75.290330, lng: 38.653861 };
  try {
    const response = await geocoder.geocode({
      location: latlng,
      fulfillOnZeroResults: true,
    });
    console.log('Plus Code:', response.plus_code);
  } catch (error) {
    console.error(`Error: ${error}`);
  }
}
```

#### 2. Address Descriptors (`extraComputations`)

Address descriptors provide relational context using nearby landmarks
(`landmarks[]` with `spatial_relationship`, `straight_line_distance_meters`,
`travel_distance_meters`) and containing areas (`areas[]` with `containment`:
`"WITHIN"`, `"OUTSKIRTS"`, or `"NEAR"`). For reverse geocoding,
`address_descriptor` is returned at the top-level response object (accessed via
the Promise response, not the legacy callback):

```javascript
async function reverseGeocodeWithDescriptors(geocoder) {
  const latlng = { lat: 28.640964, lng: 77.235875 };
  try {
    const response = await geocoder.geocode({
      location: latlng,
      extraComputations: ['ADDRESS_DESCRIPTORS'],
    });
    console.log('Address Descriptor:', response.address_descriptor);
  } catch (error) {
    console.error(`Error: ${error}`);
  }
}
```

--------------------------------------------------------------------------------

## Status Codes & Error Handling

When a request fails or returns an error status, handle the following
`GeocoderStatus` codes:

*   `"OK"`: At least one result was returned.
*   `"ZERO_RESULTS"`: Reverse geocode succeeded, but no addressable results
    matched (rejects Promise unless `fulfillOnZeroResults: true` is set).
*   `"OVER_QUERY_LIMIT"`: Quota exceeded.
*   `"REQUEST_DENIED"`: Web page is not allowed to use the geocoder (check API
    key and enabled APIs).
*   `"INVALID_REQUEST"`: Required query parameter (`address`, `location`, or
    `placeId`) is missing or malformed.
*   `"UNKNOWN_ERROR"` / `"ERROR"`: Server or network timeout error; retry the
    request.

--------------------------------------------------------------------------------

## Supporting Reference Samples

*   [Reverse Geocoding Sample](https://github.com/googlemaps/js-samples/blob/HEAD/samples/geocoding-reverse/index.ts?utm_campaign=gmp_git_agentskills_v1)
*   [Simple Geocoding & Click-to-Reverse-Geocode Sample](https://github.com/googlemaps/js-samples/blob/HEAD/samples/geocoding-simple/index.ts?utm_campaign=gmp_git_agentskills_v1)

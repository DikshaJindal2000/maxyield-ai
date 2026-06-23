import L from 'leaflet'
import {
  MapContainer,
  Marker,
  Polygon,
  TileLayer,
  useMapEvents,
} from 'react-leaflet'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import 'leaflet/dist/leaflet.css'

const AUSTIN_CENTER = [30.2672, -97.7431]
const DEFAULT_ZOOM = 15

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

function MapClickHandler({ coordinates, onPolygonChange }) {
  useMapEvents({
    click(event) {
      const next = [...coordinates, [event.latlng.lat, event.latlng.lng]]
      onPolygonChange(next)
    },
  })

  return null
}

export default function MapCanvas({ coordinates = [], onPolygonChange }) {
  return (
    <MapContainer
      center={AUSTIN_CENTER}
      zoom={DEFAULT_ZOOM}
      className="h-full w-full"
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapClickHandler
        coordinates={coordinates}
        onPolygonChange={onPolygonChange}
      />
      {coordinates.map((position, index) => (
        <Marker key={`${position[0]}-${position[1]}-${index}`} position={position} />
      ))}
      {coordinates.length >= 2 && (
        <Polygon
          positions={coordinates}
          pathOptions={{
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.35,
            weight: 2,
          }}
        />
      )}
    </MapContainer>
  )
}

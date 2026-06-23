import { useEffect, useState } from 'react'
import { jsPDF } from 'jspdf'
import * as turf from '@turf/turf'
import Auth from './components/Auth.jsx'
import MapCanvas from './components/MapCanvas.jsx'
import { supabase } from './supabaseClient.js'
import zoningRules from './zoningRules.json'

const SQ_METERS_TO_SQ_FEET = 10.763910416709722
const FEET_TO_METERS = 0.3048
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/test_7sY9AUf052iXaJua6teQM00'
const PENDING_REPORT_KEY = 'maxyield_pending_report'
const projectTypes = Object.entries(zoningRules.zoningCodes)

const LEGACY_PROJECT_TYPE_MAP = {
  Multi_Family_MF6: 'Multi-Family Residential',
  Mixed_Use_MU: 'Mixed-Use',
  Commercial_Core_CBD: 'Commercial High-Rise',
}

function resolveProjectType(projectType) {
  return LEGACY_PROJECT_TYPE_MAP[projectType] ?? projectType
}

function getProjectBaseFAR(selectedProjectType) {
  const resolvedType = resolveProjectType(selectedProjectType)
  return zoningRules.zoningCodes[resolvedType]?.baseFAR ?? null
}

function getZoningRule(selectedProjectType) {
  const resolvedType = resolveProjectType(selectedProjectType)
  return zoningRules.zoningCodes[resolvedType] ?? null
}

function calculateNetFootprintSqFt(polygon, setbacksFt) {
  const { front, rear, side } = setbacksFt
  const averageSetbackFt = (front + rear + side * 2) / 4
  const insetPolygon = turf.buffer(polygon, -averageSetbackFt * FEET_TO_METERS, {
    units: 'meters',
  })

  if (!insetPolygon) return 0

  return turf.area(insetPolygon) * SQ_METERS_TO_SQ_FEET
}

function calculateParcelMetrics(polygon, selectedProjectType) {
  const zoningRule = getZoningRule(selectedProjectType)
  if (!zoningRule) return null

  const rawSquareFeet = turf.area(polygon) * SQ_METERS_TO_SQ_FEET
  const netFootprintSqFt = calculateNetFootprintSqFt(polygon, zoningRule.setbacks_ft)

  return {
    rawSquareFeet,
    netFootprintSqFt,
  }
}

function generateReportPdf(selectedType, reportResult) {
  const doc = new jsPDF()
  const marginX = 20
  let y = 28
  const resolvedType = resolveProjectType(selectedType)
  const zoningRule = zoningRules.zoningCodes[resolvedType]

  if (!zoningRule || !reportResult) return

  const trueBuildableArea =
    reportResult.netFootprintSqFt * zoningRules.zoningCodes[resolvedType].baseFAR

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('MaxYield AI - Spatial Feasibility Brief', marginX, y)

  y += 14
  doc.setDrawColor(180, 180, 180)
  doc.line(marginX, y, 190, y)

  y += 16
  doc.setFontSize(11)

  const zoningLabel = zoningRule.description ?? resolvedType

  const reportRows = [
    ['Project Type', zoningLabel],
    [
      'Raw Land Area',
      `${reportResult.rawSquareFeet.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft`,
    ],
    [
      'Net Footprint After Setbacks',
      `${reportResult.netFootprintSqFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft`,
    ],
    [
      'FAR Multiplier',
      `${zoningRules.zoningCodes[resolvedType].baseFAR.toLocaleString(undefined, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}×`,
    ],
    [
      'True Buildable Area',
      `${trueBuildableArea.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })} sq ft`,
    ],
  ]

  reportRows.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold')
    doc.text(label, marginX, y)
    doc.setFont('helvetica', 'normal')
    doc.text(value, marginX + 62, y)
    y += 12
  })

  doc.save('MaxYield_Spatial_Report.pdf')
}

function getPendingReport() {
  const stored = sessionStorage.getItem(PENDING_REPORT_KEY)
  if (!stored) return null

  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

function leafletToTurfPolygon(coordinates) {
  const ring = coordinates.map(([lat, lng]) => [lng, lat])
  const first = ring[0]
  const last = ring[ring.length - 1]

  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push(first)
  }

  return turf.polygon([ring])
}

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [polygonCoordinates, setPolygonCoordinates] = useState([])
  const [selectedProjectType, setSelectedProjectType] = useState('')
  const [areaResult, setAreaResult] = useState(null)
  const [areaError, setAreaError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  function handlePolygonChange(coordinates) {
    setPolygonCoordinates(coordinates)
    setAreaResult(null)
    setAreaError('')
  }

  function handleCalculate() {
    if (!selectedProjectType) {
      setAreaResult(null)
      setAreaError('Select a project type to apply zoning rules.')
      return
    }

    if (polygonCoordinates.length < 3) {
      setAreaResult(null)
      setAreaError('Click at least 3 points on the map to define a parcel boundary.')
      return
    }

    const polygon = leafletToTurfPolygon(polygonCoordinates)
    const result = calculateParcelMetrics(polygon, selectedProjectType)

    if (!result) {
      setAreaResult(null)
      setAreaError('Invalid project type selected.')
      return
    }

    setAreaError('')
    setAreaResult(result)
  }

  function handleClearMap() {
    setPolygonCoordinates([])
    setAreaResult(null)
    setAreaError('')
    sessionStorage.removeItem(PENDING_REPORT_KEY)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  function handleDownloadReport() {
    const pendingReport = getPendingReport()
    const selectedType = resolveProjectType(
      selectedProjectType ||
        pendingReport?.selectedProjectType ||
        pendingReport?.projectType,
    )
    const reportResult = areaResult ?? pendingReport?.areaResult

    if (!reportResult || !selectedType) return
    if (!zoningRules.zoningCodes[selectedType]) return

    generateReportPdf(selectedType, reportResult)
    sessionStorage.removeItem(PENDING_REPORT_KEY)
  }

  function handleDownloadCheckout() {
    if (!areaResult || !selectedProjectType) return

    sessionStorage.setItem(
      PENDING_REPORT_KEY,
      JSON.stringify({ selectedProjectType, areaResult }),
    )
    window.location.href = STRIPE_PAYMENT_LINK
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') !== 'true') return

    handleDownloadReport()

    params.delete('success')
    const query = params.toString()
    const nextUrl = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname
    window.history.replaceState({}, '', nextUrl)
  }, [])

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return <Auth />
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-white">
      <aside className="flex w-[30%] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 px-8 py-10">
        <header className="mb-10">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            MaxYield AI
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Spatial yield analysis
          </p>
        </header>

        <div className="flex flex-1 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="address"
              className="text-xs font-medium uppercase tracking-wider text-zinc-400"
            >
              Address
            </label>
            <input
              id="address"
              type="text"
              placeholder="Enter property address"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white placeholder:text-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="project-type"
              className="text-xs font-medium uppercase tracking-wider text-zinc-400"
            >
              Project Type
            </label>
            <select
              id="project-type"
              value={selectedProjectType}
              onChange={(event) => {
                setSelectedProjectType(event.target.value)
                setAreaResult(null)
                setAreaError('')
              }}
              className="w-full appearance-none rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white outline-none transition focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600"
            >
              <option value="" disabled>
                Select project type
              </option>
              {projectTypes.map(([key]) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-auto flex flex-col gap-3">
            <button
              type="button"
              onClick={handleCalculate}
              className="w-full rounded-lg bg-white py-3.5 text-sm font-bold tracking-wide text-zinc-950 transition hover:bg-zinc-200 active:bg-zinc-300"
            >
              Calculate
            </button>

            <button
              type="button"
              onClick={handleClearMap}
              className="w-full rounded-lg border border-zinc-700 bg-transparent py-3 text-sm font-medium tracking-wide text-zinc-300 transition hover:border-zinc-500 hover:text-white"
            >
              Clear Map
            </button>

            {areaError && (
              <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                {areaError}
              </p>
            )}

            {areaResult && selectedProjectType && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 px-5 py-5">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Yield Analysis
                </p>

                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                      Raw Land Area
                    </p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
                      {areaResult.rawSquareFeet.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}{' '}
                      <span className="text-sm font-medium text-zinc-400">sq ft</span>
                    </p>
                  </div>

                  <div className="border-t border-zinc-800 pt-4">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                      Net Footprint After Setbacks
                    </p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
                      {areaResult.netFootprintSqFt.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}{' '}
                      <span className="text-sm font-medium text-zinc-400">sq ft</span>
                    </p>
                  </div>

                  <div className="border-t border-zinc-800 pt-4">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                      FAR Multiplier Applied
                    </p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
                      {getProjectBaseFAR(selectedProjectType).toLocaleString(undefined, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                      <span className="text-white">×</span>
                    </p>
                  </div>

                  <div className="rounded-lg border border-zinc-700/80 bg-zinc-950/60 px-4 py-4">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                      True Buildable Area
                    </p>
                    <p className="mt-1 text-3xl font-semibold tracking-tight text-white">
                      {(
                        areaResult.netFootprintSqFt * getProjectBaseFAR(selectedProjectType)
                      ).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}{' '}
                      <span className="text-base font-medium text-zinc-400">sq ft</span>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {areaResult && (
          <button
            type="button"
            onClick={handleDownloadCheckout}
            className="mt-6 w-full rounded-lg border border-zinc-600 bg-zinc-900 py-3.5 text-sm font-bold tracking-wide text-white transition hover:border-zinc-500 hover:bg-zinc-800"
          >
            Download Institutional Report
          </button>
        )}

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-6 text-left text-xs font-medium text-zinc-600 transition hover:text-zinc-400"
        >
          Sign Out
        </button>
      </aside>

      <main className="flex w-[70%] flex-col bg-zinc-950 p-6">
        <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div className="border-b border-zinc-800 px-6 py-4">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Spatial Map Canvas
            </span>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <MapCanvas
              coordinates={polygonCoordinates}
              onPolygonChange={handlePolygonChange}
            />
          </div>
        </div>
      </main>
    </div>
  )
}

export default App

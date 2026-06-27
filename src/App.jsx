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
const STRIPE_PRICE_TOKEN = 'your_placeholder_token_id'
const STRIPE_PRICE_LICENSE = 'your_placeholder_license_id'
const PENDING_REPORT_KEY = 'maxyield_pending_report'
const projectTypes = Object.entries(zoningRules.zoningCodes)

const LEGAL_DISCLAIMER =
  'LEGAL DISCLAIMER: MaxYield AI is a high-velocity preliminary massing screener. Outputs are algorithmic estimates based on municipal data and do not replace legally stamped architectural feasibility studies.'

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

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const footerMaxWidth = pageWidth - marginX * 2
  const footerLineHeight = 3.6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(120, 120, 120)

  const disclaimerLines = doc.splitTextToSize(LEGAL_DISCLAIMER, footerMaxWidth)
  const footerBlockHeight = disclaimerLines.length * footerLineHeight
  const footerStartY = pageHeight - 12 - footerBlockHeight

  disclaimerLines.forEach((line, index) => {
    doc.text(line, marginX, footerStartY + index * footerLineHeight)
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
  const [showPricingModal, setShowPricingModal] = useState(false)

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

  (useEffect(() => {
    // 1. Hold execution if the app is still processing the Supabase login state
    if (authLoading) {
      console.log("ℹ️ Auth is loading, waiting for UI to mount...");
      return;
    }

    const savedPolygon = localStorage.getItem('cached_polygon') || sessionStorage.getItem('cached_polygon');
    const savedResult = localStorage.getItem('cached_result') || sessionStorage.getItem('cached_result');
    const savedType = localStorage.getItem('cached_project_type') || sessionStorage.getItem('cached_project_type');

    console.log("🎯 REHYDRATION ENGINE: Checking storage...", { savedPolygon, savedResult, savedType });

    if (savedPolygon && savedResult && savedType) {
      try {
        const parsedPolygon = JSON.parse(savedPolygon);
        const parsedResult = JSON.parse(savedResult);
        const parsedType = JSON.parse(savedType);

        // 2. Repopulate the layout states
        setPolygonCoordinates(parsedPolygon);
        setAreaResult(parsedResult);
        setSelectedProjectType(parsedType);

        // 3. Provide a stable 2.5-second rendering window before executing the PDF download
        setTimeout(() => {
          console.log("🚀 Executing PDF download engine...");
          if (typeof generateReportPdf === 'function') {
            generateReportPdf(parsedType, parsedResult, parsedPolygon);
          } else if (typeof handleDownloadReport === 'function') {
            handleDownloadReport(parsedType, parsedResult, parsedPolygon);
          }

          // 4. Clean up storage files only after the engine triggers
          localStorage.removeItem('cached_polygon');
          localStorage.removeItem('cached_result');
          localStorage.removeItem('cached_project_type');
          sessionStorage.removeItem('cached_polygon');
          sessionStorage.removeItem('cached_result');
          sessionStorage.removeItem('cached_project_type');

          if (window.history && window.history.replaceState) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        }, 2500);
      } catch (e) {
        console.error("❌ Rehydration parsing failed:", e);
      }
    }
  }, [authLoading]); 

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
    <>
      <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 pb-16 text-white">
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
            onClick={() => setShowPricingModal(true)}
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

      {showPricingModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999]">
        <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-xl max-w-xl w-full text-white relative">
          <h3 className="text-xl font-bold mb-2">Unlock Institutional Report</h3>
          <p className="text-zinc-400 text-sm mb-6">Select a plan to download full spatial analytics, compliance setbacks, and 3D volume outputs.</p>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            
            {/* 1. Single Token ($49) Button */}
            <button 
              type="button" 
              className="border border-zinc-800 p-4 rounded-lg bg-zinc-950 hover:bg-zinc-800 transition text-left"
              onClick={(e) => {
                if (e) e.preventDefault();
                window.open("https://buy.stripe.com/test_00wfZif05e1FcRCceBeQM01", "_blank");
              }}
            >
              <div className="font-semibold text-white">Single Token</div>
              <div className="text-2xl font-bold mt-2 text-white">$49</div>
              <div className="text-xs text-zinc-500 mt-1">One-time per parcel</div>
            </button>
  
            {/* 2. Active Fund ($249) Button */}
            <button 
              type="button" 
              className="border border-blue-900 p-4 rounded-lg bg-blue-950/20 hover:bg-blue-950/40 transition text-left border-blue-500/30"
              onClick={(e) => {
                if (e) e.preventDefault();
                window.open("https://buy.stripe.com/test_dRm00kg495v9aJufqNeQM02", "_blank");
              }}
            >
              <div className="font-semibold text-blue-400">Active Fund</div>
              <div className="text-2xl font-bold mt-2 text-white">$249<span className="text-sm font-normal text-zinc-500">/mo</span></div>
              <div className="text-xs text-blue-300 mt-1">Unlimited reports</div>
            </button>
  
          </div>
        </div>
      </div>
    )}

      <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800/50 bg-zinc-950/90 px-6 py-3 backdrop-blur-sm">
        <p className="text-xs leading-relaxed text-gray-500 opacity-70">
          {LEGAL_DISCLAIMER}
        </p>
      </footer>
    </>
  )
}

export default App

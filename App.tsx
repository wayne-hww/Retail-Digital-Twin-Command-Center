
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Users, 
  Activity, 
  Map as MapIcon, 
  Clock,
  LogOut,
  Camera,
  ChevronDown,
  Monitor,
  Venus,
  Mars,
  Wifi
} from 'lucide-react';
import { 
  STORES,
  COLORS
} from './constants';
import { Customer, AgentState, Point, Gender, Hotspot, WebSocketResponse, PlanData, WebSocketMessage } from './types';

const GRID_SIZE = 25;
const WS_URL = 'ws://localhost:3000/ws?type=browser';

const App: React.FC = () => {
  const [currentStoreIdx, setCurrentStoreIdx] = useState(0);
  const store = STORES[currentStoreIdx];

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dailyStats, setDailyStats] = useState({
    totalCustomers: 0,
    quickExits: 0,
    femaleCount: 0,
    maleCount: 0,
    totalDwellTimeMs: 0,
    completedVisits: 0
  });

  const [isConnected, setIsConnected] = useState(false);
  const [liveImage, setLiveImage] = useState<string | null>(null);

  const COLS = Math.ceil(store.width / GRID_SIZE);
  const ROWS = Math.ceil(store.height / GRID_SIZE);
  
  const [heatmap, setHeatmap] = useState<Float32Array>(new Float32Array(COLS * ROWS));
  const heatmapAccumulatorRef = useRef<Float32Array>(new Float32Array(COLS * ROWS));
  const lastTimeRef = useRef<number>(performance.now());
  const requestRef = useRef<number | undefined>(undefined);
  
  // Keep track of entry times for calculating dwell time locally if needed
  const entryTimesRef = useRef<Map<string, number>>(new Map());

  const storeHotspots = useMemo(() => {
    const hs: Hotspot[] = [];
    store.racks.forEach((r, i) => hs.push({ id: `r-${i}`, pos: r.pos, label: r.label }));
    store.islands.forEach((isl, i) => {
      isl.grid.forEach((p, j) => hs.push({ id: `isl-${i}-${j}`, pos: p, label: isl.label }));
    });
    return hs;
  }, [store]);

  // Reset heatmaps on store change
  useEffect(() => {
    const newSize = Math.ceil(store.width / GRID_SIZE) * Math.ceil(store.height / GRID_SIZE);
    heatmapAccumulatorRef.current = new Float32Array(newSize);
    setHeatmap(new Float32Array(newSize));
    setCustomers([]);
  }, [currentStoreIdx, store.width, store.height]);

  // WebSocket Connection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setIsConnected(true);
        console.log('Connected to Retail Twin Stream');
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          // Check for the wrapper type and ensure data exists
          if (message.type === 'device_data' && message.data) {
            processWebSocketData(message.data);
          }
        } catch (e) {
          console.error('Failed to parse WS message', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WS Error', err);
        ws?.close();
      };
    };

    connect();

    return () => {
      ws?.close();
      clearTimeout(reconnectTimeout);
    };
  }, []);

  const processWebSocketData = (data: WebSocketResponse) => {
    // 1. Process Video Image
    if (data.video_image && data.video_image.length > 0) {
      const imgObj = data.video_image[0];
      const base64 = Object.values(imgObj)[0];
      if (base64) setLiveImage(`data:image/jpeg;base64,${base64}`);
    }

    // 2. Process Statistics
    // Note: entry_number and short_dwell_number seem to be cumulative from backend
    setDailyStats(prev => {
      // Calculate gender stats from current plan_data snapshot + accumulated history if backend doesn't provide it.
      // Since backend doesn't provide gender breakdown in stats, we might just count current active for now
      // or try to accumulate. For simplicity in this "Digital Twin" view, let's track active gender counts
      // and update total/quick exits from backend.
      
      const currentFemales = data.plan_data.filter(p => p.gender.toLowerCase() === 'female').length;
      const currentMales = data.plan_data.filter(p => p.gender.toLowerCase() === 'male').length;

      return {
        ...prev,
        totalCustomers: data.entry_number > 0 ? data.entry_number : prev.totalCustomers, // Update if non-zero
        quickExits: data.short_dwell_number > 0 ? data.short_dwell_number : prev.quickExits,
        femaleCount: currentFemales, // Showing active breakdown
        maleCount: currentMales
      };
    });

    // 3. Process Customers (Plan Data)
    setCustomers(prevCustomers => {
      const now = performance.now();
      const nextCustomers: Customer[] = [];
      const activeIds = new Set<string>();

      data.plan_data.forEach(p => {
        activeIds.add(p.track_id);
        const existing = prevCustomers.find(c => c.id === p.track_id);
        
        // Parse position [x, y]
        const targetPos = { x: p.position[0], y: p.position[1] };
        
        // Parse orientation [x, y] -> angle degrees
        const angleRad = Math.atan2(p.orientation[1], p.orientation[0]);
        const targetAngle = (angleRad * 180) / Math.PI;

        // Determine gender/color
        const gender = p.gender.toLowerCase() === 'female' ? Gender.FEMALE : Gender.MALE;
        const color = gender === Gender.FEMALE ? '#ec4899' : '#06b6d4';

        if (existing) {
          // Update existing customer
          nextCustomers.push({
            ...existing,
            target: targetPos, // Set target for interpolation
            // We don't snap angle immediately to avoid jitter, we can interp it or just snap if simple
            // For now let's just update target angle implicitly via the update loop if we wanted strict interp
            // But here we might just snap for responsiveness if we don't implement complex rotation interp
            angle: targetAngle, 
            age: p.age,
            state: AgentState.WALKING
          });
        } else {
          // New customer
          if (!entryTimesRef.current.has(p.track_id)) {
            entryTimesRef.current.set(p.track_id, Date.now());
          }

          nextCustomers.push({
            id: p.track_id,
            pos: targetPos, // Start at reported position
            target: targetPos,
            targetId: 'unknown',
            state: AgentState.WALKING,
            angle: targetAngle,
            speed: 0,
            browsingTimer: 0,
            dwellStartTime: now,
            totalStartTime: now,
            hasCountedForZone: false,
            path: [targetPos],
            color,
            gender,
            age: p.age
          });
        }
      });

      // Handle Exits (customers in prev but not in data)
      prevCustomers.forEach(c => {
        if (!activeIds.has(c.id)) {
           // Customer left.
           const entryTime = entryTimesRef.current.get(c.id);
           if (entryTime) {
             const duration = Date.now() - entryTime;
             setDailyStats(ds => ({
               ...ds,
               totalDwellTimeMs: ds.totalDwellTimeMs + duration,
               completedVisits: ds.completedVisits + 1
             }));
             entryTimesRef.current.delete(c.id);
           }
        }
      });

      return nextCustomers;
    });
  };

  const updateSimulation = useCallback((time: number) => {
    const dt = (time - lastTimeRef.current) / 16.67; 
    lastTimeRef.current = time;

    setCustomers(prev => {
      return prev.map(c => {
        let { pos, target, path } = c;

        // Simple Linear Interpolation (LERP) for smooth movement
        // Move 10% of the way to target per frame
        const lerpFactor = 0.15; 
        const dx = target.x - pos.x;
        const dy = target.y - pos.y;
        
        // If distance is significant, move
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          pos = {
            x: pos.x + dx * lerpFactor,
            y: pos.y + dy * lerpFactor
          };
          
          // Update Path occasionally
          if (path.length === 0 || Math.sqrt(Math.pow(pos.x - path[path.length-1].x, 2) + Math.pow(pos.y - path[path.length-1].y, 2)) > 30) {
            path = [...path.slice(-15), { ...pos }];
          }
        }

        // Update Heatmap
        const gridX = Math.floor(pos.x / GRID_SIZE);
        const gridY = Math.floor(pos.y / GRID_SIZE);
        const COLS_INT = Math.ceil(store.width / GRID_SIZE);
        const ROWS_INT = Math.ceil(store.height / GRID_SIZE);

        if (gridX >= 0 && gridX < COLS_INT && gridY >= 0 && gridY < ROWS_INT) {
          const idx = gridY * COLS_INT + gridX;
          if (heatmapAccumulatorRef.current[idx] !== undefined) {
            heatmapAccumulatorRef.current[idx] += 0.02 * dt;
          }
        }

        return { ...c, pos, path };
      });
    });

    if (Math.floor(time) % 60 === 0) {
      setHeatmap(new Float32Array(heatmapAccumulatorRef.current));
    }

    requestRef.current = requestAnimationFrame(updateSimulation);
  }, [store.width, store.height]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(updateSimulation);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [updateSimulation]);

  const avgDwell = useMemo(() => {
    if (dailyStats.completedVisits === 0) return 0;
    return Math.floor(dailyStats.totalDwellTimeMs / dailyStats.completedVisits / 1000);
  }, [dailyStats.totalDwellTimeMs, dailyStats.completedVisits]);

  return (
    <div className="flex flex-col h-screen text-cyan-100 p-4 select-none bg-[#080810] font-mono">
      <header className="flex justify-between items-start border-b border-cyan-900/30 pb-4 mb-4 gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Monitor className="w-8 h-8 text-cyan-400 neon-glow" />
            <h1 className="text-2xl font-black tracking-[0.1em] text-cyan-400 uppercase">Retail Intelligent Command</h1>
            {!isConnected && <span className="text-red-500 text-xs font-bold animate-pulse px-2 py-0.5 border border-red-900/50 bg-red-950/30">OFFLINE</span>}
            {isConnected && <span className="text-emerald-500 text-xs font-bold px-2 py-0.5 border border-emerald-900/50 bg-emerald-950/30 flex items-center gap-1"><Wifi className="w-3 h-3"/> LIVE</span>}
          </div>
          
          <div className="flex items-center gap-2 bg-cyan-950/30 border border-cyan-900/50 p-1.5 rounded-sm shadow-inner">
            <MapIcon className="w-4 h-4 text-cyan-500" />
            <select 
              value={currentStoreIdx}
              onChange={(e) => setCurrentStoreIdx(parseInt(e.target.value))}
              className="bg-transparent text-cyan-300 text-[11px] font-black outline-none cursor-pointer appearance-none uppercase tracking-widest px-2"
            >
              {STORES.map((s, idx) => (
                <option key={s.id} value={idx} className="bg-[#080810]">{s.name}</option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-cyan-700" />
          </div>
        </div>
        
        <div className="flex gap-12 bg-cyan-950/10 p-4 rounded-sm border border-cyan-900/20">
          <StatBox icon={<Users className="w-4 h-4" />} label="ACTIVE NOW" value={customers.length.toString()} color="text-cyan-400" />
          <StatBox icon={<Activity className="w-4 h-4" />} label="TOTAL VISITS" value={dailyStats.totalCustomers.toString()} color="text-emerald-400" />
          <StatBox icon={<LogOut className="w-4 h-4" />} label="QUICK EXITS" value={dailyStats.quickExits.toString()} color="text-red-400" />
        </div>
      </header>

      <main className="flex-1 flex gap-6 overflow-hidden">
        <aside className="w-80 flex flex-col gap-4">
          <div className="bg-black border border-cyan-900/60 rounded-sm overflow-hidden relative flex-[0.5] min-h-[300px]">
            <div className="absolute top-3 left-3 flex items-center gap-2 text-[10px] font-bold text-red-500 animate-pulse z-20">
              <Camera className="w-3.5 h-3.5" /> LIVE STREAMING
            </div>
            <div className="absolute top-3 right-3 text-[9px] text-cyan-700 z-20 font-mono bg-black/80 px-2 py-0.5 border border-cyan-900/30">
              {store.id.toUpperCase()}_SURVEILLANCE
            </div>
            
            <div className="w-full h-full flex items-center justify-center bg-[#05050c] relative overflow-hidden">
              {liveImage ? (
                <img src={liveImage} alt="Live Feed" className="w-full h-full object-cover opacity-80" />
              ) : (
                <>
                  <div className="absolute inset-0 opacity-10 pointer-events-none" 
                      style={{ backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.4) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.05), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.05))', backgroundSize: '100% 4px, 4px 100%' }} />
                  
                  <div className="relative flex flex-col items-center gap-4 opacity-20">
                    <Users className="w-20 h-20 text-cyan-900" />
                    <div className="text-[10px] text-cyan-900 uppercase tracking-[0.4em] font-black">Waiting for Visual Node...</div>
                  </div>

                  <div className="absolute bottom-0 w-full h-[1px] bg-cyan-400 shadow-[0_0_15px_#06b6d4] animate-[scan_5s_linear_infinite]" />
                </>
              )}

              {/* Overlay graphics */}
              <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-cyan-500/30" />
              <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-cyan-500/30" />
              <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-cyan-500/30" />
              <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-cyan-500/30" />
            </div>
          </div>

          <div className="flex-1 bg-cyan-950/10 border border-cyan-900/30 p-6 rounded-sm backdrop-blur-md flex flex-col">
            <h3 className="text-[11px] font-black text-cyan-500 mb-8 flex items-center gap-2 uppercase tracking-[0.2em] border-l-4 border-cyan-600 pl-3">
              Visitor Demographics
            </h3>
            
            <div className="space-y-10">
              <DemographicRow icon={<Venus className="w-6 h-6 text-pink-500" />} label="Female Visitors" value={dailyStats.femaleCount} color="text-pink-400" />
              <DemographicRow icon={<Mars className="w-6 h-6 text-cyan-500" />} label="Male Visitors" value={dailyStats.maleCount} color="text-cyan-400" />
              
              <div className="pt-6 border-t border-cyan-900/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="bg-amber-500/10 p-2.5 border border-amber-900/20">
                      <Clock className="w-6 h-6 text-amber-500" />
                    </div>
                    <span className="text-[11px] font-black text-cyan-800 uppercase tracking-widest">Avg Visit Time</span>
                  </div>
                  <span className="text-3xl font-black text-amber-500 tabular-nums neon-glow">{avgDwell}s</span>
                </div>
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-cyan-900/10 text-[9px] text-cyan-900 uppercase tracking-widest leading-relaxed">
              Real-time spatial analysis calibrated for {store.name}. System {isConnected ? 'ONLINE' : 'CONNECTING...'}.
            </div>
          </div>
        </aside>

        <section className="flex-1 relative bg-[#020205] border border-cyan-900/50 rounded-sm overflow-hidden flex items-center justify-center shadow-inner">
          <div className="absolute inset-0 pointer-events-none opacity-5">
             <div className="h-full w-full" style={{ backgroundImage: 'radial-gradient(circle, #06b6d4 1.2px, transparent 1.2px)', backgroundSize: '40px 40px' }} />
          </div>

          <svg 
            viewBox={`0 0 ${store.width} ${store.height}`} 
            className="w-full h-full max-h-[95%]"
            preserveAspectRatio="xMidYMid meet"
          >
            <g opacity="0.6">
              {Array.from({ length: Math.ceil(store.height / GRID_SIZE) }).map((_, r) => 
                Array.from({ length: Math.ceil(store.width / GRID_SIZE) }).map((_, c) => {
                  const idx = r * Math.ceil(store.width / GRID_SIZE) + c;
                  const val = heatmap[idx];
                  if (val < 0.1 || isNaN(val)) return null;
                  const opacity = Math.min(val / 15, 0.9);
                  let color = '#06b6d4';
                  if (val > 25) color = '#ef4444';
                  else if (val > 12) color = '#f59e0b';
                  
                  return (
                    <rect 
                      key={`${r}-${c}`}
                      x={c * GRID_SIZE} 
                      y={r * GRID_SIZE} 
                      width={GRID_SIZE} 
                      height={GRID_SIZE} 
                      fill={color}
                      opacity={opacity}
                      className="transition-all duration-1000"
                    />
                  );
                })
              )}
            </g>

            <g>
              <rect 
                x="2" y="2" width={store.width-4} height={store.height-4} 
                fill="none" stroke="#06b6d4" strokeWidth="2.5"
                className="neon-glow opacity-80"
              />
              <rect 
                x="12" y="12" width={store.width-24} height={store.height-24} 
                fill="none" stroke="#06b6d4" strokeWidth="1"
                className="opacity-30"
              />
              <path d={`M 2 50 L 2 2 L 50 2`} fill="none" stroke="#06b6d4" strokeWidth="5" className="neon-glow" />
              <path d={`M ${store.width-50} 2 L ${store.width-2} 2 L ${store.width-2} 50`} fill="none" stroke="#06b6d4" strokeWidth="5" className="neon-glow" />
              <path d={`M 2 ${store.height-50} L 2 ${store.height-2} L 50 ${store.height-2}`} fill="none" stroke="#06b6d4" strokeWidth="5" className="neon-glow" />
              <path d={`M ${store.width-50} ${store.height-2} L ${store.width-2} ${store.height-2} L ${store.width-2} ${store.height-50}`} fill="none" stroke="#06b6d4" strokeWidth="5" className="neon-glow" />
            </g>

            <path 
              d={`M ${store.entrance.x - 70} ${store.entrance.y} L ${store.entrance.x + 70} ${store.entrance.y}`} 
              stroke="#06b6d4" strokeWidth="8" className="neon-glow shadow-[0_0_15px_#06b6d4]"
            />
            <text x={store.entrance.x} y={store.entrance.y + 28} textAnchor="middle" fill="#06b6d4" fontSize="11" fontWeight="bold" className="opacity-50 tracking-[0.5em]">COOLER_ACCESS</text>

            <text x={store.width/2} y={store.height/2 + 20} textAnchor="middle" fill="#06b6d4" fontSize="24" fontWeight="black" className="opacity-5 tracking-[0.2em] font-sans">DAIRY WALK-IN COOLER</text>
            <text x={store.width/2} y={store.height/2 + 50} textAnchor="middle" fill="#06b6d4" fontSize="14" fontWeight="bold" className="opacity-5 tracking-[0.3em]">127 m²</text>

            {store.racks.map((r, i) => (
              <g key={`rack-${i}`}>
                <rect 
                  x={r.pos.x - r.w/2} y={r.pos.y - r.h/2} 
                  width={r.w} height={r.h} 
                  fill="#06b6d408" stroke="#06b6d4" strokeWidth="1.2"
                  className="opacity-40"
                />
                <text x={r.pos.x} y={r.pos.y + 3} textAnchor="middle" fill="#06b6d4" fontSize="7" fontWeight="bold" className="opacity-50 font-sans tracking-tighter uppercase">{r.label}</text>
              </g>
            ))}

            {store.islands.map((isl, i) => (
              <g key={`isl-${i}`}>
                {isl.label.includes('PENTAGON') ? (
                  <polygon 
                    points={`${isl.rect.x + isl.rect.w / 2},${isl.rect.y} ${isl.rect.x + isl.rect.w},${isl.rect.y + isl.rect.h * 0.4} ${isl.rect.x + isl.rect.w * 0.8},${isl.rect.y + isl.rect.h} ${isl.rect.x + isl.rect.w * 0.2},${isl.rect.y + isl.rect.h} ${isl.rect.x},${isl.rect.y + isl.rect.h * 0.4}`}
                    fill="#10b98110" stroke="#10b981" strokeWidth="2"
                    className="neon-glow-emerald opacity-60"
                  />
                ) : (
                  <rect 
                    x={isl.rect.x} y={isl.rect.y} width={isl.rect.w} height={isl.rect.h} 
                    fill="#10b98105" stroke="#10b981" strokeWidth="1.5" strokeDasharray="6 3"
                    className="opacity-30"
                  />
                )}
                <text x={isl.rect.x + isl.rect.w/2} y={isl.rect.y + isl.rect.h + 15} textAnchor="middle" fill="#10b981" fontSize="10" fontWeight="black" className="opacity-40 tracking-[0.2em] uppercase">{isl.label}</text>
              </g>
            ))}

            {customers.map(c => (
              <CustomerAgent key={c.id} customer={c} />
            ))}
          </svg>
        </section>
      </main>

      <footer className="h-10 flex justify-between items-center mt-4 border-t border-cyan-900/20 opacity-40">
         <div className="text-[10px] font-black tracking-[0.4em] text-cyan-800 uppercase">System: Makro_Coldroom_Monitoring_v6.1</div>
         <div className="flex items-center gap-8 text-[9px] text-cyan-800 font-mono">
            <span>UPLINK_STABLE</span>
            <span>DATA_FLOW_OPTIMIZED</span>
            <div className="flex items-center gap-2">
               <div className={`w-2.5 h-2.5 rounded-full animate-pulse shadow-[0_0_10px_currentColor] ${isConnected ? 'bg-emerald-500 text-emerald-500' : 'bg-red-500 text-red-500'}`} />
               <span className="uppercase font-black">{isConnected ? 'Sync Verified' : 'Sync Disconnected'}</span>
            </div>
         </div>
      </footer>

      <style>{`
        @keyframes scan { 0% { top: 0; } 100% { top: 100%; } }
      `}</style>
    </div>
  );
};

const StatBox: React.FC<{ icon: React.ReactNode, label: string, value: string, color: string }> = ({ icon, label, value, color }) => (
  <div className="flex flex-col items-start border-r border-cyan-900/10 pr-12 last:border-0 last:pr-0">
    <div className="flex items-center gap-2 text-[10px] text-cyan-900 font-black tracking-[0.3em] uppercase mb-1">
      {icon} {label}
    </div>
    <div className={`text-5xl font-black ${color} tabular-nums neon-glow tracking-tighter`}>{value}</div>
  </div>
);

const DemographicRow: React.FC<{ icon: React.ReactNode, label: string, value: number, color: string }> = ({ icon, label, value, color }) => (
  <div className="flex items-center justify-between group">
    <div className="flex items-center gap-5">
       <div className="bg-white/5 p-2.5 border border-white/5 group-hover:border-cyan-500/30 transition-colors">
         {icon}
       </div>
       <span className="text-[11px] font-black text-cyan-800 uppercase tracking-[0.2em]">{label}</span>
    </div>
    <span className={`text-4xl font-black ${color} tabular-nums neon-glow`}>{value}</span>
  </div>
);

const CustomerAgent: React.FC<{ customer: Customer }> = ({ customer }) => {
  const coneLength = 90;
  const coneAngle = 35;
  const angleRad = (customer.angle * Math.PI) / 180;
  
  const p1x = customer.pos.x + coneLength * Math.cos(angleRad - (coneAngle * Math.PI) / 180);
  const p1y = customer.pos.y + coneLength * Math.sin(angleRad - (coneAngle * Math.PI) / 180);
  const p2x = customer.pos.x + coneLength * Math.cos(angleRad + (coneAngle * Math.PI) / 180);
  const p2y = customer.pos.y + coneLength * Math.sin(angleRad + (coneAngle * Math.PI) / 180);

  return (
    <g>
      {/* Short trail for history */}
      <polyline 
        points={customer.path.map(p => `${p.x},${p.y}`).join(' ')} 
        fill="none" 
        stroke={customer.color} 
        strokeWidth="0.8" 
        strokeOpacity="0.12" 
        strokeDasharray="4,4"
      />
      {/* Vision Cone */}
      <path 
        d={`M ${customer.pos.x} ${customer.pos.y} L ${p1x} ${p1y} A ${coneLength} ${coneLength} 0 0 1 ${p2x} ${p2y} Z`}
        fill={`url(#grad-${customer.id})`}
        fillOpacity="0.5"
      />
      <defs>
        <radialGradient id={`grad-${customer.id}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform={`translate(${customer.pos.x} ${customer.pos.y}) rotate(${customer.angle}) scale(${coneLength})`}>
          <stop stopColor={customer.color} stopOpacity="0.5" />
          <stop offset="1" stopColor={customer.color} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Agent Dot */}
      <circle cx={customer.pos.x} cy={customer.pos.y} r="5.5" fill="#000" stroke={customer.color} strokeWidth="2.5" className="neon-glow shadow-lg" />
      {/* Label Tag */}
      <g transform={`translate(${customer.pos.x + 10}, ${customer.pos.y - 15})`}>
        <rect width="65" height="14" fill="black" opacity="0.85" stroke={customer.color} strokeWidth="0.5" />
        <text x="4" y="10" fill={customer.color} fontSize="9" fontWeight="black" className="font-mono">
          {customer.gender === Gender.FEMALE ? 'F' : 'M'}_{customer.age || 'Unk'}_{customer.id.slice(-4)}
        </text>
      </g>
    </g>
  );
};

export default App;

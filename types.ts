
export interface Point {
  x: number;
  y: number;
}

export enum AgentState {
  WALKING = 'WALKING',
  BROWSING = 'BROWSING',
  EXITING = 'EXITING'
}

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE'
}

export interface Customer {
  id: string;
  pos: Point;
  target: Point; // Used for interpolation
  targetId: string;
  state: AgentState;
  angle: number; // in degrees
  speed: number;
  browsingTimer: number;
  dwellStartTime: number;
  totalStartTime: number;
  hasCountedForZone: boolean;
  path: Point[];
  color: string;
  gender: Gender;
  age?: string; // Added for external data
}

export interface Hotspot {
  id: string;
  pos: Point;
  label: string;
}

export interface StoreRack {
  pos: Point;
  w: number;
  h: number;
  label: string;
}

export interface StoreIsland {
  rect: { x: number; y: number; w: number; h: number };
  grid: Point[];
  label: string;
}

export interface StoreConfig {
  id: string;
  name: string;
  width: number;
  height: number;
  entrance: Point;
  racks: StoreRack[];
  islands: StoreIsland[];
  hotspots: Hotspot[];
}

// WebSocket Data Types
export interface PlanData {
  age: string;
  bbox: number[];
  gender: string;
  track_id: string;
  orientation: number[];
  position: number[];
}

export interface WebSocketResponse {
  area: string;
  entry_number: number;
  short_dwell_number: number;
  video_image: Record<string, string>[];
  plan_data: PlanData[];
}

export interface WebSocketMessage {
  type: string;
  deviceId: string;
  data: WebSocketResponse;
}

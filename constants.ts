
import { Point, Hotspot, StoreConfig } from './types';

export const COLORS = [
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#ec4899', // Pink
];

export const STORES: StoreConfig[] = [
  {
    id: 'coldroom1',
    name: 'Makro St.57 (Bangphil-Coldroom1)',
    width: 1516,
    height: 1016,
    entrance: { x: 758, y: 980 },
    racks: [
      // Top High Racks
      ...Array.from({ length: 11 }, (_, i) => ({ 
        pos: { x: 100 + i * 130, y: 70 }, 
        w: 100, 
        h: 60, 
        label: 'HIGH RACK' 
      })),
      // Left Chillers
      ...Array.from({ length: 7 }, (_, i) => ({ 
        pos: { x: 60, y: 200 + i * 110 }, 
        w: 80, 
        h: 90, 
        label: 'CHILLER_L' 
      })),
      // Right Chillers
      ...Array.from({ length: 7 }, (_, i) => ({ 
        pos: { x: 1456, y: 200 + i * 110 }, 
        w: 80, 
        h: 90, 
        label: 'CHILLER_R' 
      })),
      // Bottom Stock Racks
      ...Array.from({ length: 5 }, (_, i) => ({ 
        pos: { x: 180 + i * 120, y: 920 }, 
        w: 100, 
        h: 50, 
        label: 'STOCK' 
      })),
      ...Array.from({ length: 5 }, (_, i) => ({ 
        pos: { x: 936 + i * 120, y: 920 }, 
        w: 100, 
        h: 50, 
        label: 'STOCK' 
      })),
    ],
    islands: [
      {
        rect: { x: 658, y: 400, w: 200, h: 200 },
        label: 'DISPLAY_HEX',
        grid: [{ x: 758, y: 500 }],
      },
    ],
    hotspots: [],
  },
  {
    id: 'coldroom2',
    name: 'Makro St.57 (Bangphil-Coldroom2)',
    width: 1118,
    height: 690,
    entrance: { x: 559, y: 650 },
    racks: [
      // Top High Racks
      ...Array.from({ length: 9 }, (_, i) => ({ 
        pos: { x: 80 + i * 120, y: 60 }, 
        w: 100, 
        h: 60, 
        label: 'HIGH RACK' 
      })),
      
      // Left Wall Shelves
      ...Array.from({ length: 4 }, (_, i) => ({ 
        pos: { x: 60, y: 180 + i * 110 }, 
        w: 80, 
        h: 90, 
        label: 'BUTTER' 
      })),
      
      // Right Wall Shelves
       ...Array.from({ length: 4 }, (_, i) => ({ 
        pos: { x: 1058, y: 180 + i * 110 }, 
        w: 80, 
        h: 90, 
        label: 'YOGHURT' 
      })),
    ],
    islands: [],
    hotspots: [],
  },
];

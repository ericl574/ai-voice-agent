import type { KnowledgeSeedChunk } from './ingestion.ts';

export const AUTO_REPAIR_VERTICAL_ID = 'auto_repair';

export const AUTO_REPAIR_KNOWLEDGE: readonly KnowledgeSeedChunk[] = [
  {
    sourceKey: 'auto_repair/brake-noise',
    title: 'Brake noise and vibration',
    content:
      'Squealing, grinding, pulsation, or vibration can have multiple causes. These symptoms are not enough to diagnose the vehicle remotely; a technician must inspect it before the shop describes the repair needed.',
    category: 'brakes',
    metadata: {
      tags: ['brakes', 'noise', 'vibration', 'inspection'],
    },
  },
  {
    sourceKey: 'auto_repair/oil-service',
    title: 'Oil service basics',
    content:
      'Oil type and change interval depend on the vehicle year, make, model, engine, driving conditions, and manufacturer guidance. The shop must confirm the correct oil and service interval for the specific vehicle.',
    category: 'maintenance',
    metadata: {
      tags: ['oil', 'maintenance', 'service-interval'],
    },
  },
  {
    sourceKey: 'auto_repair/warning-lights',
    title: 'Dashboard warning lights',
    content:
      'A dashboard warning light identifies a system that needs evaluation but usually does not identify the failed part by itself. Trouble codes and inspection findings are diagnostic inputs, not a guaranteed diagnosis.',
    category: 'diagnostics',
    metadata: {
      tags: ['warning-light', 'diagnostics', 'trouble-codes'],
    },
  },
];

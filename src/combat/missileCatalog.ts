import type { MissileGuidanceConfig } from './missileGuidance';

export interface MissileDefinition {
  launchSpeed: number;
  acceleration: number;
  maxSpeed: number;
  turnRate: number;
  flightTime: number;
  guidance: MissileGuidanceConfig;
  model: {
    length: number;
    radius: number;
    fins: number;
  };
}

export const DEFAULT_MISSILE: MissileDefinition = {
  launchSpeed: 260,
  acceleration: 150,
  maxSpeed: 850,
  turnRate: 1.6,
  flightTime: 12,
  guidance: { program: 'lead-pursuit' },
  model: { length: 3.2, radius: 0.18, fins: 4 },
};

export const MISSILE_CATALOG: Readonly<Record<string, MissileDefinition>> = {
  nova17: {
    launchSpeed: 260, acceleration: 175, maxSpeed: 780, turnRate: 2.4, flightTime: 10,
    guidance: { program: 'proportional-navigation', navigationConstant: 3.2 },
    model: { length: 2.5, radius: 0.14, fins: 3 },
  },
  meteor88: {
    launchSpeed: 320, acceleration: 150, maxSpeed: 1050, turnRate: 1.15, flightTime: 16,
    guidance: { program: 'proportional-navigation', navigationConstant: 3.5 },
    model: { length: 4.2, radius: 0.2, fins: 4 },
  },
  hellfire09: {
    launchSpeed: 220, acceleration: 115, maxSpeed: 690, turnRate: 1.05, flightTime: 12,
    guidance: { program: 'lead-pursuit', maxLeadTime: 1.4 },
    model: { length: 3.4, radius: 0.24, fins: 4 },
  },
  vortex33: {
    launchSpeed: 245, acceleration: 135, maxSpeed: 760, turnRate: 1.35, flightTime: 14,
    guidance: { program: 'lead-pursuit', maxLeadTime: 2 },
    model: { length: 3.7, radius: 0.22, fins: 3 },
  },
  stinger05: {
    launchSpeed: 285, acceleration: 190, maxSpeed: 820, turnRate: 2.8, flightTime: 8,
    guidance: { program: 'pure-pursuit' },
    model: { length: 2.2, radius: 0.12, fins: 4 },
  },
  thunder66: {
    launchSpeed: 250, acceleration: 155, maxSpeed: 850, turnRate: 1.7, flightTime: 12,
    guidance: { program: 'proportional-navigation', navigationConstant: 3 },
    model: { length: 3.3, radius: 0.17, fins: 4 },
  },
  gungnir01: {
    launchSpeed: 210, acceleration: 185, maxSpeed: 980, turnRate: 0.9, flightTime: 16,
    guidance: { program: 'lead-pursuit', maxLeadTime: 3 },
    model: { length: 5.2, radius: 0.28, fins: 4 },
  },
  frostbite12: {
    launchSpeed: 275, acceleration: 160, maxSpeed: 810, turnRate: 2.05, flightTime: 12,
    guidance: { program: 'proportional-navigation', navigationConstant: 2.8 },
    model: { length: 3.1, radius: 0.15, fins: 3 },
  },
  ironhammer20: {
    launchSpeed: 195, acceleration: 120, maxSpeed: 720, turnRate: 0.85, flightTime: 14,
    guidance: { program: 'lead-pursuit', maxLeadTime: 1.8 },
    model: { length: 4.5, radius: 0.3, fins: 4 },
  },
  phoenix54: {
    launchSpeed: 300, acceleration: 205, maxSpeed: 1020, turnRate: 1.55, flightTime: 16,
    guidance: { program: 'proportional-navigation', navigationConstant: 3.4 },
    model: { length: 4.7, radius: 0.18, fins: 3 },
  },
};

export function getMissileDefinition(id: string): MissileDefinition {
  return MISSILE_CATALOG[id] ?? DEFAULT_MISSILE;
}

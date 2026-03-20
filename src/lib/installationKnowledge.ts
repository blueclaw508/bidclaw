// Jamie Layer 1 — Built-in Installation Knowledge Base
// Standard component mappings for common landscape & masonry work types
// Easy to expand: just add new entries to the object below

export interface ComponentFormula {
  item: string
  qty_formula: string // e.g. "LF * 0.5" — evaluated with quantity as variable
  unit: string
  category?: 'materials' | 'equipment'
}

export interface ClarifyingOption {
  label: string
  components?: string[] // which components to include for this option
  qty_multiplier?: number // for depth/coverage questions
}

export interface ClarifyingQuestion {
  question: string
  options: ClarifyingOption[]
}

export interface InstallationEntry {
  unit: string
  components: ComponentFormula[]
  clarifying_question?: ClarifyingQuestion
}

export const installationKnowledge: Record<string, InstallationEntry> = {
  "bluestone coping": {
    unit: "LF",
    components: [
      { item: "Mortar Mix", qty_formula: "QTY * 0.5", unit: "BAG" },
      { item: "Bond All Adhesive", qty_formula: "QTY * 0.1", unit: "TUBE" },
      { item: "Cut-Off Saw", qty_formula: "QTY / 50", unit: "HR", category: "equipment" },
    ],
    clarifying_question: {
      question: "How are you installing this coping?",
      options: [
        { label: "Mortar set", components: ["Mortar Mix", "Bond All Adhesive", "Cut-Off Saw"] },
        { label: "Dry set", components: ["Bedding Sand", "Edge Restraint"] },
        { label: "Adhesive only", components: ["Bond All Adhesive"] },
      ],
    },
  },

  "pavers": {
    unit: "SF",
    components: [
      { item: "Polymeric Sand", qty_formula: "QTY / 50", unit: "BAG" },
      { item: "Edge Restraint", qty_formula: "QTY * 0.15", unit: "LF" },
      { item: "Plate Compactor", qty_formula: "QTY / 500", unit: "HR", category: "equipment" },
      { item: "Gravel Base", qty_formula: "(QTY * 0.5) / 27", unit: "CY" },
      { item: "Bedding Sand", qty_formula: "QTY / 100", unit: "TON" },
    ],
  },

  "sod": {
    unit: "SF",
    components: [
      { item: "Loam", qty_formula: "(QTY * 0.5) / 27", unit: "CY" },
      { item: "Starter Fertilizer", qty_formula: "QTY / 1000", unit: "BAG" },
      { item: "Sod Roller", qty_formula: "QTY / 2000", unit: "HR", category: "equipment" },
    ],
  },

  "mulch": {
    unit: "CY",
    components: [
      { item: "Bed Edging", qty_formula: "QTY * 8", unit: "LF" },
    ],
  },

  "plant material": {
    unit: "EA",
    components: [
      { item: "Cow Manure", qty_formula: "QTY * 0.25", unit: "BAG" },
      { item: "Peat Moss", qty_formula: "QTY * 0.125", unit: "BAG" },
      { item: "Healthy Start", qty_formula: "QTY * 0.04", unit: "BAG" },
    ],
  },

  "retaining wall block": {
    unit: "SF",
    components: [
      { item: "Gravel Base", qty_formula: "QTY * 0.3", unit: "TON" },
      { item: "Drainage Pipe", qty_formula: "QTY * 0.5", unit: "LF" },
      { item: "Filter Fabric", qty_formula: "QTY * 1.2", unit: "SF" },
      { item: "Plate Compactor", qty_formula: "QTY / 200", unit: "HR", category: "equipment" },
    ],
    clarifying_question: {
      question: "Does this wall require drainage?",
      options: [
        { label: "Yes", components: ["Gravel Base", "Drainage Pipe", "Filter Fabric", "Plate Compactor"] },
        { label: "No", components: ["Gravel Base", "Plate Compactor"] },
      ],
    },
  },

  "natural stone wall": {
    unit: "SF",
    components: [],
    clarifying_question: {
      question: "Is this wall mortared or dry stacked?",
      options: [
        { label: "Mortared", components: ["Mortar Mix", "Bond All Adhesive", "Cut-Off Saw"] },
        { label: "Dry stacked", components: [] },
      ],
    },
  },

  "loam": {
    unit: "CY",
    components: [],
    clarifying_question: {
      question: "What depth of loam is being installed?",
      options: [
        { label: "4 inches", qty_multiplier: 0.33 },
        { label: "6 inches", qty_multiplier: 0.5 },
        { label: "8 inches", qty_multiplier: 0.67 },
      ],
    },
  },
}

// Evaluate a quantity formula like "QTY * 0.5" or "(QTY * 0.5) / 27"
export function evaluateFormula(formula: string, quantity: number): number {
  const expr = formula.replace(/QTY/gi, String(quantity))
  // Safe math eval — only allows numbers, operators, parens
  if (!/^[\d\s.+\-*/()]+$/.test(expr)) return 0
  try {
    return Math.round(Function(`"use strict"; return (${expr})`)() * 100) / 100
  } catch {
    return 0
  }
}

// Find matching installation entry by fuzzy name match
export function findInstallationEntry(itemName: string): { key: string; entry: InstallationEntry } | null {
  const lower = itemName.toLowerCase().trim()

  // Exact match first
  if (installationKnowledge[lower]) {
    return { key: lower, entry: installationKnowledge[lower] }
  }

  // Partial match — check if item name contains a known key
  for (const [key, entry] of Object.entries(installationKnowledge)) {
    if (lower.includes(key) || key.includes(lower)) {
      return { key, entry }
    }
  }

  return null
}

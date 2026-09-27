type ObjectValue = Record<string, unknown>;
const record = (value: unknown): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
export interface InventorySkill {
  path: string;
  available: boolean;
  discovered: boolean | 'unknown';
  sha256?: string;
  name?: string;
}

/** Prepared files prove availability only; agent resource discovery is separate. */
export function availableSkills(provenance: ObjectValue): InventorySkill[] {
  if (!Array.isArray(provenance.resources)) return [];
  return provenance.resources.flatMap((value) => {
    const resource = record(value);
    if (typeof resource.path !== 'string' || !/(?:^|\/)SKILL\.md$/.test(resource.path)) return [];
    return [
      {
        path: resource.path,
        available: true,
        discovered: 'unknown' as const,
        ...(typeof resource.sha256 === 'string' ? { sha256: resource.sha256 } : {}),
      },
    ];
  });
}

export function discoveredSkills(
  available: InventorySkill[],
  discovered: Array<{ path: string; name?: string }>,
): InventorySkill[] {
  const inventory = new Map(
    available.map((skill) => [skill.path, { ...skill, discovered: false } as InventorySkill]),
  );
  for (const skill of discovered) {
    inventory.set(skill.path, {
      ...inventory.get(skill.path),
      ...skill,
      available: true,
      discovered: true,
    });
  }
  return [...inventory.values()];
}

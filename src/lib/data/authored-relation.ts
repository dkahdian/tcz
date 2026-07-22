import type { DescriptionComponent, DirectedSuccinctnessRelation } from '../types.js';

function isDerivedComponent(component: DescriptionComponent | undefined): boolean {
  return component?.derived === true || component?.origin === 'derived' || component?.origin === 'batch';
}

function partialRelation(
  relation: DirectedSuccinctnessRelation,
  status: 'no-poly-unknown-quasi' | 'unknown-poly-quasi',
  component: DescriptionComponent
): DirectedSuccinctnessRelation {
  const {
    noPolyDescription: _noPolyDescription,
    quasiDescription: _quasiDescription,
    proof: _proof,
    ...base
  } = relation;

  return {
    ...base,
    status,
    description: component.description,
    refs: [...component.refs],
    derived: false,
    origin: 'authored'
  };
}

/**
 * Return the source-authored portion of a propagated succinctness relation.
 *
 * Propagation may combine independently-authored and derived halves into a
 * no-poly-quasi relation. Canonical authoring formats must serialize only the
 * authored half, with the status weakened to match the surviving claim.
 */
export function authoredRelation(
  relation: DirectedSuccinctnessRelation | null | undefined
): DirectedSuccinctnessRelation | null {
  if (
    !relation ||
    relation.derived === true ||
    relation.origin === 'derived' ||
    relation.origin === 'batch'
  ) {
    return null;
  }

  if (
    relation.status !== 'no-poly-quasi' ||
    (!relation.noPolyDescription && !relation.quasiDescription)
  ) {
    return relation;
  }

  const noPoly = relation.noPolyDescription;
  const quasi = relation.quasiDescription;
  const authoredNoPoly = noPoly && !isDerivedComponent(noPoly) ? noPoly : undefined;
  const authoredQuasi = quasi && !isDerivedComponent(quasi) ? quasi : undefined;

  if (!authoredNoPoly && !authoredQuasi) return null;
  if (authoredNoPoly && !authoredQuasi) {
    return partialRelation(relation, 'no-poly-unknown-quasi', authoredNoPoly);
  }
  if (!authoredNoPoly && authoredQuasi) {
    return partialRelation(relation, 'unknown-poly-quasi', authoredQuasi);
  }

  return {
    ...relation,
    refs: [...new Set([...(authoredNoPoly?.refs ?? []), ...(authoredQuasi?.refs ?? [])])],
    derived: false,
    origin: 'authored'
  };
}

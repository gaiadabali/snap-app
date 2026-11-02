import { BadRequestException } from '@nestjs/common';

import { findWorkspaceCategory } from '../repo.js';

/**
 * Filing a receipt in a category, from a correction (`edits`).
 *
 * Two paths, one effect (docs/DEDUCTIONS.md):
 *
 *   `header.category_id`  a category id of the caller's workspace, active or
 *                         not, or null to take the receipt out of its category.
 *   `header.category`     a category NAME. This is what phones already
 *                         installed send: `EditFields.tsx` always includes it,
 *                         with the receipt's current category name, so a save
 *                         of any other field carried it. Equal to the current
 *                         name (or "Uncategorised" while there is none) it is a
 *                         no-op, so those phones can save again. Anything else
 *                         must name a category of the workspace, or it is a 400.
 *                         "Uncategorised" on a filed receipt takes it out of
 *                         its category, the same as the id path with null.
 *
 * Both are the same edit to the server: a person's choice
 * (`category_source = 'user'`).
 */

export const CATEGORY_PATHS = ['header.category_id', 'header.category'] as const;

export const UNCATEGORISED = 'Uncategorised';

/** The current filing of the receipt being edited. */
export type CurrentCategory = { category_id: string | null; category_name: string | null };

/** `{ categoryId }` is a change to apply (null clears); null means leave it alone. */
export type CategoryEdit = { categoryId: string | null } | null;

const norm = (v: string): string => v.trim().toLowerCase();

export async function resolveCategoryEdit(
  userId: string,
  tenantId: string,
  edits: Record<string, string | number | null>,
  current: CurrentCategory,
): Promise<CategoryEdit> {
  const hasId = Object.prototype.hasOwnProperty.call(edits ?? {}, 'header.category_id');
  const hasName = Object.prototype.hasOwnProperty.call(edits ?? {}, 'header.category');

  if (hasId) {
    // Wins over the name when both arrive: the id is exact.
    const value = edits['header.category_id'];
    if (value === null) return { categoryId: null };
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(
        "'header.category_id' must be a category id of this workspace, or null to clear it.",
      );
    }
    const found = await findWorkspaceCategory(userId, tenantId, { id: value.trim() });
    if (!found) {
      throw new BadRequestException('That category does not exist in this workspace.');
    }
    return { categoryId: found.id };
  }

  if (hasName) {
    const value = edits['header.category'];
    const hasCategory = current.category_id !== null;
    const name = value == null ? UNCATEGORISED : String(value).trim();
    if (hasCategory && current.category_name !== null && norm(name) === norm(current.category_name)) {
      return null;
    }
    if (norm(name) === norm(UNCATEGORISED)) {
      // Nothing to change when there is no category; otherwise clear it.
      return hasCategory ? { categoryId: null } : null;
    }
    const found = await findWorkspaceCategory(userId, tenantId, { name });
    if (!found) {
      throw new BadRequestException(
        `There is no category called "${name}" in this workspace. Choose one of your categories, or leave the category alone.`,
      );
    }
    // Already there, under a different capitalisation: still nothing to do.
    if (found.id === current.category_id) return null;
    return { categoryId: found.id };
  }

  return null;
}

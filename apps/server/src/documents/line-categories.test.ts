import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { ReplaceLinesDto, SetLineCategoriesDto } from './documents.controller.js';
import { carryLineCategories } from './line-categories.js';

/** The same options `ValidBody` gives the ValidationPipe. */
async function errorsOf<T extends object>(cls: new () => T, body: unknown): Promise<string[]> {
  const dto = plainToInstance(cls, body, { enableImplicitConversion: false });
  const errors = await validate(dto as object, { whitelist: true, forbidNonWhitelisted: true });
  const flat = (es: typeof errors, path = ''): string[] =>
    es.flatMap((e) => [
      ...Object.values(e.constraints ?? {}).map((m) => `${path}${e.property}: ${m}`),
      ...flat(e.children ?? [], `${path}${e.property}.`),
    ]);
  return flat(errors);
}

describe('carryLineCategories: a filed line keeps its category when the lines are replaced', () => {
  const filed = [
    { lineNumber: 2, description: 'Hammer 450g', categoryId: 'tools' },
    { lineNumber: 4, description: 'Safety glasses', categoryId: 'ppe' },
  ];

  it('the same docket read again: every filing stays where it was', () => {
    const next = [1, 2, 3, 4].map((n) => ({ lineNumber: n, description: ['Milk', 'Hammer 450g', 'Bread', 'Safety glasses'][n - 1]! }));
    expect([...carryLineCategories(filed, next)]).toEqual([[2, 'tools'], [4, 'ppe']]);
  });

  it('a line removed above it: the filing follows the description, ignoring case and spacing', () => {
    const next = [
      { lineNumber: 1, description: 'HAMMER  450G ' },
      { lineNumber: 2, description: 'Bread' },
      { lineNumber: 3, description: 'Safety glasses' },
    ];
    expect([...carryLineCategories(filed, next)]).toEqual([[1, 'tools'], [3, 'ppe']]);
  });

  it('a renamed line is unfiled; two identical lines are each carried once', () => {
    expect([...carryLineCategories(filed, [{ lineNumber: 2, description: 'Claw hammer' }])]).toEqual([]);
    const twice = [
      { lineNumber: 1, description: 'Pen', categoryId: 'a' },
      { lineNumber: 2, description: 'Pen', categoryId: 'b' },
    ];
    expect([...carryLineCategories(twice, [{ lineNumber: 1, description: 'Pen' }, { lineNumber: 2, description: 'Pen' }, { lineNumber: 3, description: 'Pen' }])])
      .toEqual([[1, 'a'], [2, 'b']]);
  });

  it('an empty description is only carried to the same line number', () => {
    const blank = [{ lineNumber: 3, description: null, categoryId: 'tools' }];
    expect([...carryLineCategories(blank, [{ lineNumber: 1, description: '' }])]).toEqual([]);
    expect([...carryLineCategories(blank, [{ lineNumber: 3, description: ' ' }])]).toEqual([[3, 'tools']]);
  });
});

describe('the line DTOs', () => {
  const line = { description: 'Hammer', quantity: 1, unitPrice: '25.00', amount: '25.00', gstFree: false };

  it('PUT lines takes the lines the review screens hold, whole (they were refused before)', async () => {
    const asHeld = { ...line, lineNumber: 2, category: null, categoryId: null, confidence: 0.9 };
    expect(await errorsOf(ReplaceLinesDto, { lines: [asHeld] })).toEqual([]);
    expect(await errorsOf(ReplaceLinesDto, { lines: [{ ...line, categoryId: 'c0ffee00-0000-4000-8000-000000000001', category: 'Tools' }] })).toEqual([]);
    expect(await errorsOf(ReplaceLinesDto, { lines: [line] })).toEqual([]);
    expect(await errorsOf(ReplaceLinesDto, { lines: [{ ...line, accountId: 'x' }] })).not.toEqual([]);
    expect(await errorsOf(ReplaceLinesDto, { lines: [{ ...line, categoryId: 7 }] })).not.toEqual([]);
  });

  it('PATCH lines/categories: line numbers and ids (or null), nothing else', async () => {
    expect(await errorsOf(SetLineCategoriesDto, { lines: [{ lineNumber: 1, categoryId: 'abc' }, { lineNumber: 2, categoryId: null }], version: 3 })).toEqual([]);
    expect(await errorsOf(SetLineCategoriesDto, { lines: [] })).not.toEqual([]);
    expect(await errorsOf(SetLineCategoriesDto, { lines: [{ lineNumber: 0, categoryId: null }] })).not.toEqual([]);
    expect(await errorsOf(SetLineCategoriesDto, { lines: [{ lineNumber: 1 }] })).not.toEqual([]);
    expect(await errorsOf(SetLineCategoriesDto, { lines: [{ lineNumber: 1, categoryId: null, amount: '1' }] })).not.toEqual([]);
  });
});

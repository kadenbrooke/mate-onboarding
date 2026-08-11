import { describe, it, expect } from 'vitest';
import { parseNoteJson, toNoteFields, fillableFields } from './noteExtract';

describe('parseNoteJson', () => {
  it('parses a bare JSON object', () => {
    expect(parseNoteJson('{"name":"Dave"}')).toEqual({ name: 'Dave' });
  });

  it('survives a ```json fence and surrounding prose', () => {
    expect(parseNoteJson('```json\n{"city":"Lehi"}\n```')).toEqual({ city: 'Lehi' });
    expect(parseNoteJson('Sure! {"city":"Lehi"} hope that helps')).toEqual({ city: 'Lehi' });
  });

  it('returns null for junk, empty output, or a JSON array', () => {
    expect(parseNoteJson('')).toBeNull();
    expect(parseNoteJson('no json here')).toBeNull();
    expect(parseNoteJson('{not json}')).toBeNull();
    expect(parseNoteJson('[1,2,3]')).toBeNull();
  });
});

describe('toNoteFields', () => {
  it('maps the model fields and converts dollars to cents', () => {
    expect(toNoteFields({
      name: 'Dave Cook', email: 'dave@x.com', address: '1450 E Center St',
      city: 'Lehi', service: 'driveway sealcoat', quote_dollars: 2200,
    })).toEqual({
      name: 'Dave Cook', email: 'dave@x.com', address: '1450 E Center St',
      city: 'Lehi', service: 'driveway sealcoat', quote_cents: 220000,
    });
  });

  it('accepts a formatted dollar string', () => {
    expect(toNoteFields({ quote_dollars: '$2,200.50' }).quote_cents).toBe(220050);
  });

  it('nulls out blanks, the literal string "null", and non-positive quotes', () => {
    const out = toNoteFields({ name: '  ', city: 'null', quote_dollars: 0 });
    expect(out.name).toBeNull();
    expect(out.city).toBeNull();
    expect(out.quote_cents).toBeNull();
  });

  it('returns an empty object when parsing failed', () => {
    expect(toNoteFields(null)).toEqual({});
  });
});

describe('fillableFields', () => {
  it('only fills fields the lead is missing', () => {
    const patch = fillableFields(
      { name: 'Dave', city: 'Lehi', quote_cents: 220000 },
      { name: 'Dave C.', city: null, quote_cents: null },
    );
    // name already set on the lead -- an operator's earlier value always wins.
    expect(patch).toEqual({ city: 'Lehi', quote_cents: 220000 });
  });

  it('ignores nulls from the extraction', () => {
    expect(fillableFields({ name: null, city: null }, { name: null, city: null })).toEqual({});
  });

  it('treats an empty string on the lead as missing', () => {
    expect(fillableFields({ service: 'driveway' }, { service: '' })).toEqual({ service: 'driveway' });
  });
});

import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { extractBlissClasses, type ExtractedClass } from './extract.js';

function parse(source: string): ExtractedClass[] {
  const sf = ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, /* setParentNodes */ true);
  return extractBlissClasses(ts, sf);
}

describe('extractBlissClasses', () => {
  it('ignores classes with no static inputs/events table', () => {
    expect(parse(`class Plain extends HTMLElement {}`)).toEqual([]);
  });

  it('extracts attribute + member from an inline inputs table', () => {
    const [cls] = parse(`
      class Widget extends BlissElement {
        static inputs = [
          { configKey: 'selectionMode', attribute: 'selection-mode',
            converter: toEnum(['single', 'multiple'], { default: 'single' }),
            description: 'How many options can be picked.' },
        ];
      }
    `);
    expect(cls!.name).toBe('Widget');
    expect(cls!.attributes).toEqual([
      {
        name: 'selection-mode',
        fieldName: 'selectionMode',
        type: { text: "'single' | 'multiple'" },
        default: "'single'",
        description: 'How many options can be picked.',
      },
    ]);
    expect(cls!.members[0]).toMatchObject({
      kind: 'field',
      name: 'selectionMode',
      privacy: 'public',
      attribute: 'selection-mode',
      type: { text: "'single' | 'multiple'" },
      description: 'How many options can be picked.',
    });
  });

  it('maps each converter to a type and captures defaults + reflect', () => {
    const [cls] = parse(`
      class W extends BlissElement {
        static inputs = [
          { configKey: 'height', attribute: 'height', converter: toInt({ default: 50 }) },
          { configKey: 'ratio', attribute: 'ratio', converter: toFloat() },
          { configKey: 'label', attribute: 'label', converter: toText({ default: 'hi' }) },
          { configKey: 'hint', attribute: 'hint', converter: toText({ isNullable: true }) },
          { configKey: 'disabled', attribute: 'disabled', converter: toBool('presence'), reflect: true },
          { configKey: 'state', attribute: 'state', converter: toBool('tristate') },
          { configKey: 'tags', attribute: 'tags', converter: toList() },
          { configKey: 'options', converter: toObjectArray() },
          { configKey: 'meta', converter: toObject() },
          { configKey: 'onPick', converter: toFunction() },
        ];
      }
    `);
    const byKey = Object.fromEntries(cls!.members.map((m) => [m.name, m]));
    expect(byKey.height!.type).toEqual({ text: 'number' });
    expect(byKey.height!.default).toBe('50');
    expect(byKey.ratio!.type).toEqual({ text: 'number' });
    expect(byKey.label!.type).toEqual({ text: 'string' });
    expect(byKey.label!.default).toBe("'hi'");
    expect(byKey.hint!.type).toEqual({ text: 'string | null' });
    expect(byKey.disabled!.type).toEqual({ text: 'boolean' });
    expect(byKey.disabled!.reflects).toBe(true);
    expect(byKey.state!.type).toEqual({ text: 'boolean | null' });
    expect(byKey.tags!.type).toEqual({ text: 'string[]' });
    expect(byKey.options!.type).toEqual({ text: 'unknown[]' });
    expect(byKey.meta!.type).toEqual({ text: 'object' });
    expect(byKey.onPick!.type).toEqual({ text: 'Function' });
    // property-only inputs (no attribute) produce a member but no attribute
    expect(cls!.attributes.map((a) => a.name)).not.toContain('options');
    expect(byKey.options!.attribute).toBeUndefined();
  });

  it('follows an identifier to a const table and unwraps `as const`', () => {
    const [cls] = parse(`
      const INPUTS = [
        { configKey: 'height', attribute: 'height', converter: toInt({ default: 10 }) },
      ] as const;
      class W extends BlissElement {
        static inputs = INPUTS;
      }
    `);
    expect(cls!.members[0]).toMatchObject({ name: 'height', type: { text: 'number' }, default: '10' });
  });

  it('reads description from a leading comment when no description field', () => {
    const [cls] = parse(`
      class W extends BlissElement {
        static inputs = [
          /** The visible label. */
          { configKey: 'label', attribute: 'label', converter: toText() },
        ];
      }
    `);
    expect(cls!.members[0]!.description).toBe('The visible label.');
  });

  it('captures row-level default and deprecated', () => {
    const [cls] = parse(`
      class W extends BlissElement {
        static inputs = [
          { configKey: 'x', attribute: 'x', converter: toInt(), default: 7, deprecated: 'use y' },
        ];
      }
    `);
    expect(cls!.members[0]!.default).toBe('7');
    expect(cls!.members[0]!.deprecated).toBe('use y');
  });

  it('extracts events from bare names and EventDef objects', () => {
    const [cls] = parse(`
      class W extends BlissElement {
        static events = [
          'select',
          { name: 'change', description: 'Selection changed.', deprecated: true },
        ];
      }
    `);
    expect(cls!.events).toEqual([
      { name: 'select' },
      { name: 'change', description: 'Selection changed.', deprecated: true },
    ]);
  });
});

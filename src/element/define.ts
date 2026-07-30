/**
 * Idempotent `customElements.define`. Safe to call repeatedly and during SSR
 * (where `customElements` is absent): a name already registered is left alone.
 */
export function define(
  name: string,
  ctor: CustomElementConstructor,
  options?: ElementDefinitionOptions,
): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(name)) return;
  customElements.define(name, ctor, options);
}

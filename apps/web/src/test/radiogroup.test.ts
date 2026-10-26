// Radios ARIA au clavier (E6) : flèches, un seul arrêt de tabulation. L'action est testée sur un groupe construit à la
// main (les manches du salon sont devenues une liste déroulante en vague 5 ; le rythme reste en radios).
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/svelte';
import { radiogroup } from '../lib/radiogroup';

function group(values: string[], checked: string): HTMLElement {
  const node = document.createElement('div');
  node.setAttribute('role', 'radiogroup');
  for (const v of values) {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(v === checked));
    b.setAttribute('aria-label', v);
    b.addEventListener('click', () => {
      for (const r of node.querySelectorAll('[role="radio"]')) r.setAttribute('aria-checked', String(r === b));
    });
    node.appendChild(b);
  }
  document.body.appendChild(node);
  return node;
}

describe('radiogroup « Temps par tour »', () => {
  it('un seul radio est tabulable ; ArrowLeft / ArrowRight changent la valeur et le focus', async () => {
    const node = group(['30 s', '2 min'], '2 min');
    const action = radiogroup(node);
    const radios = [...node.querySelectorAll<HTMLElement>('[role="radio"]')];
    expect(radios).toHaveLength(2);
    const checked = radios.find((r) => r.getAttribute('aria-checked') === 'true')!;
    const other = radios.find((r) => r !== checked)!;
    expect(checked).toHaveAttribute('tabindex', '0');
    expect(other).toHaveAttribute('tabindex', '-1');
    checked.focus();
    await fireEvent.keyDown(checked, { key: 'ArrowRight' });
    expect(other).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(other);
    await fireEvent.keyDown(other, { key: 'ArrowLeft' });
    expect(checked).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(checked);
    action.destroy();
    node.remove();
  });
});

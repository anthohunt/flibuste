import { fireEvent, screen } from '@testing-library/svelte';

/** Exercise the visible trigger and actual sheet option, as the player does. */
export async function chooseOption(trigger: HTMLElement, value: string): Promise<void> {
  await fireEvent.click(trigger);
  const option = screen.getAllByRole('option').find((element) => element.getAttribute('data-value') === value);
  if (!option) throw new Error(`No visible option ${value} in ${trigger.getAttribute('aria-label')}`);
  await fireEvent.click(option);
}

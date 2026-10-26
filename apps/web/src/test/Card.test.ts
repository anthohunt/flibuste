import {describe,it,expect} from 'vitest';
import {render,cleanup} from '@testing-library/svelte';
import Card from '../components/Card.svelte';
import {artIdFor,cardLabel} from '../lib/cardMeta';
import type {Card as CardT,Suit} from '../lib/types';

describe('Approved card faces',()=>{
  it.each(['sm','md','lg'] as const)('shows the actual rank at both corners at %s size',size=>{
    for(const suit of ['parrot','map','chest','roger'] as Suit[])for(const rank of [1,6,7,9,14]){
      const card:CardT={id:suit+'-'+rank,kind:'number',suit,rank};const {container}=render(Card,{props:{card,size}});
      expect(container.querySelector('image')?.getAttribute('href')).toBe('/art/approved-v2/'+suit+'.webp');
      expect([...container.querySelectorAll('[data-rank]')].map(e=>e.textContent)).toEqual([String(rank),String(rank)]);
      expect(container.querySelectorAll('[data-bar]').length).toBe([6,9].includes(rank)?2:0);cleanup();
    }
  });
  it.each(['escape','pirateking','mermaid','tigress','kraken','whale','loot','wild15','mate','volley','plank','stingray','davy','storm'] as const)('maps %s to its approved artwork and accessible name',kind=>{
    const card={id:kind,kind} as CardT;const {container}=render(Card,{props:{card}});
    expect(container.querySelector('image')?.getAttribute('href')).toBe('/art/approved-v2/'+kind+'.webp');
    expect(container.querySelector('[role=img]')?.getAttribute('aria-label')).toBe(cardLabel(card));
  });
  it('maps all named pirates',()=>{for(const pirate of ['helm','trader','adjuster','oracle','gambler','hexer'] as const){const card:CardT={id:pirate,kind:'pirate',pirate};const {container}=render(Card,{props:{card}});expect(artIdFor(card)).toBe(pirate);expect(container.querySelector('image')?.getAttribute('href')).toBe('/art/approved-v2/'+pirate+'.webp');cleanup()}});
  it('never exposes the face of a hidden card',()=>{const {container}=render(Card,{props:{card:{id:'pirateking',kind:'pirateking'},faceDown:true}});expect(container.querySelector('[data-approved]')).toBeNull();expect(container.querySelector('[role=img]')?.getAttribute('aria-label')).toBe('Carte face cachée')});
  it('shows declared rank and suit for flex14',()=>{const {container}=render(Card,{props:{card:{id:'flex14-map',kind:'flex14',suit:'map'},as:0}});expect(container.querySelector('[data-declared]')?.textContent).toBe('0');expect(container.textContent).toContain('Compas')});
  it('shows the chosen suit of wild15',()=>{const {container}=render(Card,{props:{card:{id:'wild15',kind:'wild15'},as:'parrot'}});expect(container.textContent).toContain('Albatros');expect(container.textContent).toContain('15')});
  it('prints the expansion bonus under the digit (7 → −5) and retains disabled styling',()=>{const {container}=render(Card,{props:{card:{id:'ext7',kind:'number',suit:'parrot',rank:7,expansion:true},disabled:true}});expect(container.querySelector('[data-bonus-print]')?.textContent).toBe('−5');expect(container.querySelector('.is-muted')).not.toBeNull()});
});

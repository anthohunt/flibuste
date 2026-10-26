// Indirection vers la stratégie des bots (`@flibuste/bots`). Si la stratégie lève, `offline.ts`
// retombe sur un coup légal aléatoire (`randomBot.ts`) : la partie ne se bloque jamais.
// Vague 6 : `decide(view, profile, opts)` — si le paquet chargé ne connaît pas encore les profils, on lui
// passe le niveau classique le plus proche (`legacyLevelOf`) ; s'il refuse le profil, même repli.
import * as bots from '@flibuste/bots';
import type { Action, PlayerView } from '@flibuste/engine';
import { botsKnowProfiles, legacyLevelOf, profileOf } from './botProfile';
import type { BotOptions, ChooseAction } from './randomBot';
export type { BotLevel, BotProfile, BotOptions, ChooseAction } from './randomBot';

type Decide = (view: PlayerView, bot: unknown, opts?: BotOptions) => Action;
const decide: Decide = ((bots as unknown as { decide?: Decide }).decide ?? (bots.chooseAction as unknown as Decide)) as Decide;

const chooseWithProfile: ChooseAction = (view, bot, opts) => {
  const profile = profileOf(bot);
  if (view.legal.length === 1) return view.legal[0]!;
  if (botsKnowProfiles()) {
    try {
      return decide(view, profile, opts);
    } catch (e) {
      // Un profil que cette version refuse : le niveau classique le plus proche.
      if (!(e instanceof Error) || /legal|no legal/i.test(e.message)) throw e;
    }
  }
  return decide(view, legacyLevelOf(profile), opts);
};

export function getBot(): ChooseAction {
  return chooseWithProfile;
}

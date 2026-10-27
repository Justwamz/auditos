import acceptance from '../content/checklists/acceptance.json';
import planning from '../content/checklists/planning.json';
import fieldworkCore from '../content/checklists/fieldwork-core.json';
import completion from '../content/checklists/completion.json';
import preplanningMeeting from '../content/checklists/preplanning-meeting.json';
import clientMeeting from '../content/checklists/client-meeting.json';
import systemDocumentation from '../content/checklists/system-documentation.json';
import riskAssessment from '../content/checklists/risk-assessment.json';
import lawsRegulations from '../content/checklists/laws-regulations.json';
import relatedParties from '../content/checklists/related-parties.json';
import itEnvironment from '../content/checklists/it-environment.json';
import journalsTrialBalance from '../content/checklists/journals-trial-balance.json';
import goingConcern from '../content/checklists/going-concern.json';
import openingBalances from '../content/checklists/opening-balances.json';
import sectorTrading from '../content/checklists/sector-trading.json';
import sectorConsultancy from '../content/checklists/sector-consultancy.json';
import sectorRental from '../content/checklists/sector-rental.json';
import type { Condition, GeneratedChecklist, Profile, Sector, Template } from './types';

const SECTOR_PACKS: Sector[] = ['trading', 'consultancy', 'rental'];

export function loadTemplates(): Template[] {
  return [acceptance, preplanningMeeting, clientMeeting, planning, systemDocumentation, riskAssessment, lawsRegulations, relatedParties, itEnvironment, fieldworkCore, journalsTrialBalance, goingConcern, openingBalances, completion, sectorTrading, sectorConsultancy, sectorRental] as Template[];
}

function matches(c: Condition | undefined, p: Profile): boolean {
  if (!c) return true;
  if (c.sector && !c.sector.includes(p.sector)) return false;
  if (c.framework && c.framework !== p.framework) return false;
  if (c.riskFlag && !p.riskFlags.includes(c.riskFlag)) return false;
  return true;
}

export function generateChecklists(
  profile: Profile,
  templates: Template[],
): { checklists: GeneratedChecklist[]; notices: string[] } {
  const checklists = templates
    .filter((t) => matches(t.applies, profile))
    .map((t) => ({
      templateId: t.id,
      templateVersion: t.version,
      title: t.title,
      phase: t.phase,
      items: t.items.filter((i) => matches(i.when, profile)),
    }))
    .filter((c) => c.items.length > 0);

  const notices: string[] = [];
  if (!SECTOR_PACKS.includes(profile.sector)) {
    notices.push(`Sector pack not available for ${profile.sector}; core checklists only.`);
  }
  return { checklists, notices };
}

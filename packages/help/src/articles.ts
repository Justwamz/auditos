import { clientsAndAdmin } from '../content/clients-and-admin';
import { gettingStarted } from '../content/getting-started';
import { reviewAndApproval } from '../content/review-and-approval';
import { troubleshooting } from '../content/troubleshooting';
import type { Article } from './types';

/** Every help article. The help is written for the system as it is built today; unbuilt features are not described. */
export const ARTICLES: Article[] = [...gettingStarted, ...reviewAndApproval, ...clientsAndAdmin, ...troubleshooting];

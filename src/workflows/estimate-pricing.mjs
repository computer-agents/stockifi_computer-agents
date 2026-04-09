import { pricingAssumptions, PRICING_SOURCES, estimatePricingTable } from '../pricing.mjs';
import { printHeading, printJson } from '../utils.mjs';

printHeading('Stockifi Pricing Assumptions');
printJson('sources', PRICING_SOURCES);
printJson('assumptions', pricingAssumptions);

printHeading('Estimated Monthly Cost And Suggested Price');
printJson('scenarios', estimatePricingTable());

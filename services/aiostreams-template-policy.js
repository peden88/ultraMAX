'use strict';

const DEFAULT_TEMPLATE_ID = 'ultramax.standard';

function getAioStreamsTemplatePolicy() {
  return {
    id: process.env.AIOSTREAMS_TEMPLATE_ID || DEFAULT_TEMPLATE_ID,
    sourceUrl: process.env.AIOSTREAMS_TEMPLATE_URL || null,
    version: process.env.AIOSTREAMS_TEMPLATE_VERSION || null,
    mode: 'baseline-plus-user-credentials'
  };
}

/**
 * UltraMAX owns the baseline policy (addons, filters, sorting, matching,
 * formatter). Per-user credentials are overlaid separately at provisioning
 * time so updating the standard template never requires embedding secrets.
 */
function describeTemplateOwnership() {
  return {
    templateOwns: ['addons', 'filters', 'sorting', 'matching', 'formatter'],
    userOwns: ['serviceCredentials'],
    ultraMaxOwns: ['binding', 'credentialDerivation', 'provisioningState']
  };
}

module.exports = { DEFAULT_TEMPLATE_ID, getAioStreamsTemplatePolicy, describeTemplateOwnership };

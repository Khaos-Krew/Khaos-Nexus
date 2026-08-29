'use strict';

function evaluateSentinalRelease(release) {
  const reasons = [];
  if (!release) reasons.push('release_not_found');
  if (release && release.target !== 'KNX-SENTINAL-CORE-PROD') reasons.push('wrong_target');
  if (release && release.artifact_type !== 'SENTINAL_RUNTIME') reasons.push('runtime_change_not_required');
  if (release && release.build_status !== 'passed') reasons.push('build_not_passed');
  if (release && release.test_status !== 'passed') reasons.push('tests_not_passed');
  if (release && release.validation_status !== 'passed') reasons.push('validation_not_passed');
  if (release && release.approval_status !== 'approved') reasons.push('release_not_approved');
  return { allowed: reasons.length === 0, reasons };
}

module.exports = { evaluateSentinalRelease };

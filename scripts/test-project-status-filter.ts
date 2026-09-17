import assert from 'node:assert/strict'
import { matchesProjectStatusFilter as matches, type ProposalProgress } from '../src/lib/projectProgress'
const proposal = (status: ProposalProgress['status']): ProposalProgress[] => [{status,created_at:'2026-09-17T12:00:00Z'}]
for (const status of ['complete','lost','archived'] as const) {
  assert.equal(matches(status,[],'active'),false)
  assert.equal(matches(status,[],status),true)
  assert.equal(matches(status,[],'all'),true)
}
for (const status of ['draft','estimating','proposed','approved','in_progress'] as const) assert.equal(matches(status,[],'active'),true)
for (const [proposalStatus,projectStatus] of [['completed','complete'],['lost','lost']] as const) {
  assert.equal(matches('estimating',proposal(proposalStatus),'active'),false)
  assert.equal(matches('estimating',proposal(proposalStatus),projectStatus),true)
  assert.equal(matches('estimating',proposal(proposalStatus),'estimating'),false)
  assert.equal(matches('estimating',proposal(proposalStatus),'all'),true)
}
assert.equal(matches('approved',proposal('lost'),'active'),true,'Lost revision must not close an approved project')
assert.equal(matches('estimating',proposal('sent'),'proposed'),true)
assert.equal(matches('draft',proposal('ready_to_send'),'active'),true)
console.log('PASS: active/closed statuses, proposal-derived progress, explicit filters, All, approved revision protection')

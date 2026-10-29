# Edge Function capacity plan

Production currently has no verified free Edge Function slot. The `student-identity` source in this branch must therefore not be deployed until capacity is created safely or the project limit is raised.

No deployed function may be deleted merely to make room. Before any consolidation, inventory every caller in Pages, workflows, scheduled jobs and external integrations; compare that with production invocation logs over an agreed retention period; recover the exact deployed source; and document rollback. Only a function proven unused by both source references and runtime evidence may be proposed for removal in a separate reviewed change.

Preferred order: request a temporary/paid limit increase; otherwise consolidate only closely related identity endpoints after staging compatibility tests. Production deletion and deployment remain separate approval-gated operations.

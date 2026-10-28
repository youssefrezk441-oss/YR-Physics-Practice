#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const uuid = (namespace, value) => {
  const hex = hash(`${namespace}:${value}`).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
};
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlJson = (value) => `${sqlText(JSON.stringify(value))}::jsonb`;
const parseArgs = (args) => Object.fromEntries(args.flatMap((value, index) => value.startsWith('--') ? [[value.slice(2), args[index + 1]]] : []));

export function renderPaperHomeworkSeed({ publicPath, privatePath, reportPath, outputPath }) {
  const publicRaw = readFileSync(publicPath, 'utf8');
  const content = JSON.parse(publicRaw);
  const secrets = JSON.parse(readFileSync(privatePath, 'utf8'));
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  if (content.delivery_contract !== 'paper_homework_capture_v1' || secrets.delivery_contract !== content.delivery_contract) throw new Error('Unsupported delivery contract.');
  if (secrets.workshop_slug !== content.workshop.slug) throw new Error('Public/private workshop mismatch.');
  if (secrets.public_content_sha256 !== hash(publicRaw)) throw new Error('Public content changed after private review. Rebuild the package.');
  const parts = content.questions.flatMap((question) => question.parts.map((part) => ({ question, part })));
  if (parts.length !== secrets.keys.length || report.private_key_count !== parts.length) throw new Error('Every public part must have exactly one reviewed private key.');
  const keys = new Map(secrets.keys.map((key) => [`${key.question_ref}:${key.part_key}`, key]));
  if (parts.some(({ question, part }) => !keys.has(`${question.id}:${part.key}`))) throw new Error('A reviewed private key is missing.');

  const slug = content.workshop.slug;
  const workshopId = uuid('paper-homework', slug);
  const versionId = uuid('paper-homework-version', `${slug}:1:${secrets.public_content_sha256}`);
  const trackId = uuid('paper-homework-track', `${versionId}:home`);
  const lines = [
    '-- PRIVATE DEPLOYMENT ARTIFACT. Contains answer keys and teacher solutions.',
    '-- Generated locally; never commit this file or copy it into the Pages artifact.',
    'begin;',
    `insert into private.workshop_definitions (id, slug, title, grade_level, academic_term, lecture_no, status, eligible_group_codes) values (${sqlText(workshopId)}::uuid, ${sqlText(slug)}, ${sqlText(content.workshop.title)}, ${sqlText(content.workshop.grade_level)}, ${sqlText(content.workshop.academic_term)}, ${Number(content.workshop.lecture_no)}, 'draft', '[]'::jsonb) on conflict (slug) do nothing;`,
    `insert into private.workshop_versions (id, workshop_id, version_no, content_sha256, source_label, status, validation_report) values (${sqlText(versionId)}::uuid, ${sqlText(workshopId)}::uuid, 1, ${sqlText(secrets.public_content_sha256)}, 'Lecture 1 second-term homework — owner-reviewed CSV/PDF', 'validated', ${sqlJson(report)}) on conflict (workshop_id, version_no) do nothing;`,
    `update private.workshop_definitions set active_version_id = ${sqlText(versionId)}::uuid where id = ${sqlText(workshopId)}::uuid and status = 'draft' and active_version_id is null;`,
    `insert into private.workshop_tracks (id, version_id, track_key, title, mode, sort_order, policy) values (${sqlText(trackId)}::uuid, ${sqlText(versionId)}::uuid, 'home', ${sqlText(content.tracks[0].title)}, 'final_submit', 1, ${sqlJson(content.tracks[0].policy)}) on conflict (version_id, track_key) do nothing;`,
  ];
  for (const skill of content.skills) {
    const id = uuid('paper-homework-skill', `${versionId}:${skill.id}`);
    lines.push(`insert into private.workshop_skills (id, version_id, skill_ref, name, sort_order) values (${sqlText(id)}::uuid, ${sqlText(versionId)}::uuid, ${sqlText(skill.id)}, ${sqlText(skill.name)}, ${Number(skill.order)}) on conflict (version_id, skill_ref) do nothing;`);
  }
  for (const question of content.questions) {
    const questionId = uuid('paper-homework-question', `${versionId}:${question.id}`);
    lines.push(`insert into private.workshop_questions (id, version_id, question_ref, source_ref, source_kind, question_kind, title, prompt_text, image_path, image_sha256, skill_ref, difficulty, metadata, active) values (${sqlText(questionId)}::uuid, ${sqlText(versionId)}::uuid, ${sqlText(question.id)}, ${sqlText(String(question.source_number))}, ${sqlText(question.source_kind)}, ${sqlText(question.kind)}, ${sqlText(question.title)}, null, ${sqlText(question.image)}, ${sqlText(question.image_sha256)}, ${sqlText(question.skill)}, ${sqlText(question.difficulty)}, ${sqlJson({ response_kind: question.response_kind, source_number: question.source_number })}, true) on conflict (version_id, question_ref) do nothing;`);
    lines.push(`insert into private.workshop_track_questions (version_id, track_id, question_id, sort_order) values (${sqlText(versionId)}::uuid, ${sqlText(trackId)}::uuid, ${sqlText(questionId)}::uuid, ${Number(question.order)}) on conflict (track_id, question_id) do nothing;`);
    for (const [index, part] of question.parts.entries()) {
      const partId = uuid('paper-homework-part', `${questionId}:${part.key}`);
      const keyId = uuid('paper-homework-key', `${partId}:1`);
      const activationId = uuid('paper-homework-activation', `${partId}:1`);
      const reviewed = keys.get(`${question.id}:${part.key}`);
      const keyPayload = {
        answer_spec: reviewed.answer_spec,
        display_answer: reviewed.display_answer,
        feedback_hint: reviewed.feedback_hint,
        explanation: reviewed.explanation,
      };
      const publicConfig = { response_contract: part.response_contract, essay_self_review: question.response_kind === 'essay_self_review' };
      lines.push(`insert into private.workshop_question_parts (id, version_id, question_id, part_key, label, input_type, options_public, max_points, public_config, sort_order) values (${sqlText(partId)}::uuid, ${sqlText(versionId)}::uuid, ${sqlText(questionId)}::uuid, ${sqlText(part.key)}, ${sqlText(part.label)}, ${sqlText(part.input_type)}, ${sqlJson(part.options)}, 1, ${sqlJson(publicConfig)}, ${index + 1}) on conflict (question_id, part_key) do nothing;`);
      lines.push(`insert into private.workshop_part_key_versions (id, part_id, version_no, answer_spec, display_answer, feedback_hint, explanation, content_sha256, change_reason, source_kind) values (${sqlText(keyId)}::uuid, ${sqlText(partId)}::uuid, 1, ${sqlJson(reviewed.answer_spec)}, ${sqlText(reviewed.display_answer)}, ${reviewed.feedback_hint ? sqlText(reviewed.feedback_hint) : 'null'}, ${sqlText(reviewed.explanation)}, ${sqlText(hash(JSON.stringify(keyPayload)))}, 'Initial import reviewed against the supplied answer review and original question image', 'initial_import') on conflict (part_id, version_no) do nothing;`);
      lines.push(`insert into private.workshop_part_key_activations (id, part_id, key_version_id, activation_kind, activation_reason) values (${sqlText(activationId)}::uuid, ${sqlText(partId)}::uuid, ${sqlText(keyId)}::uuid, 'initial_import', 'Initial reviewed answer key for the independent paper-homework capture') on conflict (id) do nothing;`);
    }
  }
  lines.push(`insert into private.homework_delivery_policies (workshop_id, enabled, allow_unanswered, essay_self_review, notes) values (${sqlText(workshopId)}::uuid, false, true, true, 'Prepared and validated locally; requires explicit production publication approval') on conflict (workshop_id) do nothing;`);
  lines.push(`insert into private.ch2_mistake_source_policies (workshop_id, source_contract, enabled, notes) values (${sqlText(workshopId)}::uuid, 'paper_homework_capture_v1', true, 'Include verified answered MCQ errors and locked essay self-reviews; exclude unanswered parts') on conflict (workshop_id) do nothing;`);
  lines.push('commit;', '');
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, lines.join('\n'), { mode: 0o600 });
  return { workshop_id: workshopId, version_id: versionId, question_count: content.questions.length, part_count: parts.length, enabled: false };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const args = parseArgs(process.argv.slice(2));
    for (const key of ['public', 'private', 'report', 'output']) if (!args[key]) throw new Error(`Missing --${key}`);
    const output = resolve(args.output);
    if (!output.includes(`${resolve('.workshop-private')}/`)) throw new Error('Seed SQL must remain below .workshop-private/.');
    console.log(JSON.stringify(renderPaperHomeworkSeed({ publicPath: resolve(args.public), privatePath: resolve(args.private), reportPath: resolve(args.report), outputPath: output })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

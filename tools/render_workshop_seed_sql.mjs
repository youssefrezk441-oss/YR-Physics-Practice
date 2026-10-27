#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const dollarJson = (value, label) => {
  const json = JSON.stringify(value);
  if (json.includes('$workshop_json$')) throw new Error(`${label} contains the reserved SQL dollar-quote tag.`);
  return '$workshop_json$' + json + '$workshop_json$::jsonb';
};
function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || !argv[index + 1]) throw new Error('Arguments must be --name value pairs.');
    args[argv[index].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index + 1];
  }
  return args;
}

export function renderWorkshopSeed(publicManifest, privateImport, validationReport) {
  if (validationReport?.ok !== true) throw new Error('Refusing to render a seed from a failed validation report.');
  if (publicManifest.workshop?.status !== 'draft') throw new Error('Public manifest must remain draft before staging import.');
  if (publicManifest.workshop?.slug !== privateImport.workshop_slug) throw new Error('Public and private workshop slugs differ.');
  const contentHash = sha256(JSON.stringify(publicManifest));
  if (contentHash !== privateImport.public_content_sha256) throw new Error('Public content hash differs from the private import contract.');
  const decoratedPrivate = {
    ...privateImport,
    keys: privateImport.keys.map((key) => ({
      ...key,
      content_sha256: sha256(JSON.stringify({ answer_spec: key.answer_spec, display_answer: key.display_answer, feedback_hint: key.feedback_hint, explanation: key.explanation })),
    })),
  };
  const publicJson = dollarJson(publicManifest, 'public manifest');
  const privateJson = dollarJson(decoratedPrivate, 'private import');
  const reportJson = dollarJson(validationReport, 'validation report');
  return `-- GENERATED PRIVATE STAGING SEED. Contains answer keys; never commit or publish this file.\n` +
`-- The imported workshop remains draft/validated and is not student-visible.\n` +
`begin;\n` +
`set local lock_timeout = '5s';\n` +
`set local statement_timeout = '60s';\n\n` +
`do $workshop_seed$\n` +
`declare\n` +
`  public_doc jsonb := ${publicJson};\n` +
`  private_doc jsonb := ${privateJson};\n` +
`  validation_doc jsonb := ${reportJson};\n` +
`  item jsonb; part_item jsonb; key_item jsonb;\n` +
`  v_workshop_id uuid; v_version_id uuid; v_track_id uuid; v_question_id uuid; v_part_id uuid; v_key_id uuid;\n` +
`begin\n` +
`  if exists (select 1 from private.workshop_definitions where slug = public_doc #>> '{workshop,slug}') then\n` +
`    raise exception 'workshop slug already exists; import is intentionally non-overwriting';\n` +
`  end if;\n\n` +
`  insert into private.workshop_definitions(slug, title, grade_level, academic_term, lecture_no, status)\n` +
`  values (public_doc #>> '{workshop,slug}', public_doc #>> '{workshop,title}',\n` +
`          public_doc #>> '{workshop,grade_level}', public_doc #>> '{workshop,academic_term}',\n` +
`          (public_doc #>> '{workshop,lecture_no}')::integer, 'draft')\n` +
`  returning id into v_workshop_id;\n\n` +
`  insert into private.workshop_versions(workshop_id, version_no, content_sha256, source_label, status, validation_report)\n` +
`  values (v_workshop_id, 1, private_doc->>'public_content_sha256',\n` +
`          'YR_Physics_Lecture1_Workshop_Codex_v2 validated import', 'validated', validation_doc)\n` +
`  returning id into v_version_id;\n` +
`  update private.workshop_definitions set active_version_id = v_version_id where id = v_workshop_id;\n\n` +
`  for item in select value from jsonb_array_elements(public_doc->'tracks') loop\n` +
`    insert into private.workshop_tracks(version_id, track_key, title, mode, sort_order, policy)\n` +
`    values (v_version_id, item->>'key', item->>'title', item->>'mode', (item->>'order')::integer, item->'policy');\n` +
`  end loop;\n\n` +
`  for item in select value from jsonb_array_elements(public_doc->'skills') loop\n` +
`    insert into private.workshop_skills(version_id, skill_ref, name, sort_order)\n` +
`    values (v_version_id, item->>'id', item->>'name', (item->>'order')::integer);\n` +
`  end loop;\n\n` +
`  for item in select value from jsonb_array_elements(public_doc->'questions') loop\n` +
`    insert into private.workshop_questions\n` +
`      (version_id, question_ref, source_ref, source_kind, question_kind, title, prompt_text,\n` +
`       image_path, image_sha256, skill_ref, difficulty, metadata, active)\n` +
`    values (v_version_id, item->>'id', case when item->>'source_kind' = 'original_bank_image' then item->>'id' else null end,\n` +
`            item->>'source_kind', item->>'kind', item->>'title', item->>'prompt', item->>'image',\n` +
`            item->>'image_sha256', item->>'skill', item->>'difficulty', '{}'::jsonb, true)\n` +
`    returning id into v_question_id;\n` +
`    select id into v_track_id from private.workshop_tracks where version_id = v_version_id and track_key = item->>'track';\n` +
`    insert into private.workshop_track_questions(version_id, track_id, question_id, sort_order)\n` +
`    values (v_version_id, v_track_id, v_question_id, (item->>'order')::integer);\n` +
`    for part_item in select value from jsonb_array_elements(item->'parts') loop\n` +
`      insert into private.workshop_question_parts\n` +
`        (version_id, question_id, part_key, label, input_type, options_public, unit_text, max_points, public_config, sort_order)\n` +
`      values (v_version_id, v_question_id, part_item->>'key', part_item->>'label', part_item->>'input_type',\n` +
`              part_item->'options', part_item->>'unit', 1, '{}'::jsonb, 1);\n` +
`    end loop;\n` +
`  end loop;\n\n` +
`  for key_item in select value from jsonb_array_elements(private_doc->'keys') loop\n` +
`    select part.id into v_part_id\n` +
`    from private.workshop_question_parts part\n` +
`    join private.workshop_questions question on question.id = part.question_id\n` +
`    where question.version_id = v_version_id and question.question_ref = key_item->>'question_ref'\n` +
`      and part.part_key = key_item->>'part_key';\n` +
`    if v_part_id is null then raise exception 'private key has no matching public part: %', key_item->>'question_ref'; end if;\n` +
`    insert into private.workshop_part_key_versions\n` +
`      (part_id, version_no, answer_spec, display_answer, feedback_hint, explanation,\n` +
`       content_sha256, change_reason, source_kind)\n` +
`    values (v_part_id, 1, key_item->'answer_spec', key_item->>'display_answer',\n` +
`            key_item->>'feedback_hint', key_item->>'explanation', key_item->>'content_sha256',\n` +
`            coalesce('Initial reviewed teacher-key import. ' || nullif(key_item->>'correction_note',''),\n` +
`                     'Initial reviewed teacher-key import'), 'initial_import')\n` +
`    returning id into v_key_id;\n` +
`    insert into private.workshop_part_key_activations\n` +
`      (part_id, key_version_id, previous_key_version_id, activation_kind, activation_reason)\n` +
`    values (v_part_id, v_key_id, null, 'initial_import', 'Initial reviewed teacher-key import');\n` +
`  end loop;\n` +
`end\n` +
`$workshop_seed$;\n\n` +
`commit;\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.public || !args.private || !args.report || !args.output) throw new Error('Usage: --public FILE --private FILE --report FILE --output FILE');
    if (!args.output.includes('/.workshop-private/') && !args.output.startsWith('/tmp/')) throw new Error('Private SQL output must be under .workshop-private/ or /tmp/.');
    const sql = renderWorkshopSeed(readJson(args.public), readJson(args.private), readJson(args.report));
    writeFileSync(args.output, sql, { flag: 'wx', mode: 0o600 });
    console.log(`Private staging seed written to ${args.output}. It remains draft and must not be committed.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

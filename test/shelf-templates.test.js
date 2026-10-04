import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShelfPlan, parseLength } from '../src/lib/shelving.ts';
import { designThumbnailSvg, SHELF_TEMPLATES } from '../src/lib/shelfTemplates.ts';
import { sagCheck } from '../src/lib/shelfEstimate.ts';

// Mirror of the builder's form → config for template fields (inches).
const DEFAULTS = {
  thickness: '3/4', bayWidth: '17 1/2', shelfDepth: '11 1/4', heightMode: 'opening', openingHeight: '8', height: '74',
  bays: 4, shelvesPerBay: [1, 1, 1, 1], topPanel: true, bottomPanel: true, backPanel: true, joinery: 'dado', dadoDepth: '1/4',
  mounting: 'floor', toeKick: '3', frenchCleat: false, cleatHeight: '3', bayWidthMode: 'same', adjustablePerBay: [], doorsPerBay: [],
  pinSystem: 'imperial', backJoint: 'inset', faceFrame: false, stileWidth: '1 1/2', railWidth: '1 1/2', frameThickness: '3/4',
  shelfLoad: 'books', edgeBanding: false, bandingThickness: '0.5 mm',
};
const inch = v => parseLength(v, 'in');

function configFor(template) {
  const f = { ...DEFAULTS, ...template.fields };
  const t = inch(f.thickness);
  const toeKick = f.mounting === 'floor' && f.bottomPanel ? (Number(f.toeKick) === 0 ? 0 : inch(f.toeKick)) : 0;
  const maxShelves = Math.max(...f.shelvesPerBay);
  const allowance = (f.topPanel ? t : 0) + (f.bottomPanel ? t : 0) + toeKick;
  const height = f.heightMode === 'opening' ? (maxShelves + 1) * inch(f.openingHeight) + maxShelves * t + allowance : inch(f.height);
  return {
    thickness: t, bayWidth: inch(f.bayWidth), shelfDepth: inch(f.shelfDepth), height, bays: f.bays, shelvesPerBay: f.shelvesPerBay,
    topPanel: f.topPanel, bottomPanel: f.bottomPanel, backPanel: f.backPanel, joinery: f.joinery, dadoDepth: f.joinery === 'dado' ? inch(f.dadoDepth) : 0,
    mounting: f.mounting, toeKick, frenchCleat: f.frenchCleat, cleatHeight: inch(f.cleatHeight),
    bayWidths: f.bayWidthMode === 'custom' ? f.bayWidths.map(inch) : undefined,
    adjustablePerBay: f.adjustablePerBay, pinSystem: f.pinSystem, backJoint: f.backJoint,
    faceFrame: f.faceFrame ? { enabled: true, stileWidth: inch(f.stileWidth), railWidth: inch(f.railWidth), thickness: inch(f.frameThickness) } : undefined,
    doorsPerBay: f.doorsPerBay, shelfLoad: f.shelfLoad, edgeBanding: f.edgeBanding, bandingThickness: inch(f.bandingThickness),
  };
}

test('every template is a buildable design with no errors and shelves that do not sag', () => {
  const ids = new Set();
  for (const template of SHELF_TEMPLATES) {
    assert.ok(!ids.has(template.id), `duplicate id ${template.id}`);
    ids.add(template.id);
    const n = template.fields.bays;
    for (const key of ['shelvesPerBay', 'adjustablePerBay', 'doorsPerBay']) {
      assert.equal(template.fields[key]?.length ?? n, n, `${template.id}: ${key} has one entry per bay`);
    }
    const config = configFor(template);
    const plan = buildShelfPlan(config);
    assert.deepEqual(plan.errors, [], template.id);
    assert.ok(plan.parts.length > 3, template.id);
    assert.ok(sagCheck(plan, config).every(r => r.ok), `${template.id} shelves sag under their own load`);
    assert.match(designThumbnailSvg(plan, config.thickness), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  }
});

test('the small wall shelf template is the 1/2" two-opening example', () => {
  const plan = buildShelfPlan(configFor(SHELF_TEMPLATES.find(t => t.id === 'floating-shelf')));
  assert.equal(plan.overallHeight, 2 * 6 + 3 * 0.5);
});

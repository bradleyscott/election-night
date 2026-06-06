import { load } from 'cheerio';

const full = load('<div id="electorate_details_partycandidate_content"><table id="candidate_votes"><tbody><tr><td><span>Name</span><span>100</span></td></tr></tbody></table></div>');
const inner = full('#electorate_details_partycandidate_content #candidate_votes').html();
console.log('inner HTML:', JSON.stringify(inner));

const $ = load(inner);
console.log('reloaded html:', JSON.stringify($.html()));
console.log('tr count:', $('tr').length);

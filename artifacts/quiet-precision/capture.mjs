import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/home/abdelkader/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Europe/Paris'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const shot=async(name)=>{await page.waitForTimeout(500);await page.screenshot({path:`artifacts/quiet-precision/${name}.png`,animations:'disabled'});};
await page.goto('http://127.0.0.1:5173');await shot('final-welcome');
await page.getByRole('button',{name:'Explore the live demo',exact:true}).click();await page.getByRole('button',{name:'New task',exact:true}).waitFor();
const widths=[];
for(const [width,height] of [[1440,900],[768,1024],[390,844]]){await page.setViewportSize({width,height});await shot(`final-${width}`);widths.push({width,scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth)});}
await page.getByRole('button',{name:/^Inbox/}).filter({has:page.locator('svg')}).last().click();await shot('final-mobile-inbox');
await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'New task',exact:true}).click();await shot('final-create');await page.keyboard.press('Escape');
await page.locator('.block-title').filter({hasText:'Shape the new portfolio'}).click();await shot('final-edit');await page.keyboard.press('Escape');
await page.getByRole('button',{name:'Archive',exact:true}).click();await shot('final-empty');
await writeFile('artifacts/quiet-precision/browser-observations.json',JSON.stringify({errors,widths},null,2));await browser.close();

# End-to-end run in Chrome at phone size, against the built app in demo mode.
import re, sys
from playwright.sync_api import sync_playwright, expect

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173/'
OUT = '/tmp/shots/'
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.goto(URL); pg.wait_for_selector('.welcome')
    pg.screenshot(path=OUT + '01_welcome.png')
    pg.get_by_text('Try the demo shop').click()
    pg.wait_for_selector('.onboarding', timeout=60000)
    pg.get_by_role('button', name='Next').click()
    pg.get_by_role('button', name='Grocery').click(); pg.get_by_role('button', name='Next').click()
    pg.screenshot(path=OUT + '02_language.png')
    pg.get_by_role('button', name='Next').click()
    pg.screenshot(path=OUT + '03_currency.png')
    pg.get_by_role('button', name='Start using HisabEasy').click()
    pg.wait_for_selector('.today-card', timeout=60000)
    pg.wait_for_timeout(500)
    pg.screenshot(path=OUT + '04_home.png', full_page=True)
    before = pg.locator('.today-amount').inner_text()
    print('today sales before:', before)

    # Credit sale with two products to Mohammed, part paid
    pg.get_by_role('button', name='Add Sale').click()
    pg.wait_for_selector('.product-grid')
    pg.locator('.product-tile', has_text='Coconut Oil').click()
    pg.locator('.product-tile', has_text='Coconut Oil').click()
    pg.locator('.product-tile', has_text='Sugar').click()
    pg.locator('.row.picker').first.click()
    pg.locator('.sheet .row', has_text='Mohammed').click()
    pg.get_by_role('button', name='Credit (Udhar)').click()
    pg.locator('.toggle-row', has_text='Paid something now').locator('input').check()
    pg.locator('.sheet-body, .card').locator('.amount-input input').last.fill('100')
    pg.screenshot(path=OUT + '05_new_sale.png', full_page=True)
    total = pg.locator('.footer-total b').inner_text(); print('bill total:', total)
    pg.get_by_role('button', name='Save bill').click()
    pg.wait_for_selector('.receipt')
    pg.screenshot(path=OUT + '06_receipt.png', full_page=True)
    rtext = pg.locator('.receipt').inner_text()
    assert '426' in rtext and '326' in rtext, rtext   # 2×190 + 46 = 426; paid 100 → 326 due

    # Khata: Mohammed's profile, receive payment
    pg.goto(URL + '#/khata'); pg.wait_for_selector('.khata-hero')
    pg.screenshot(path=OUT + '07_khata.png', full_page=True)
    pg.locator('.row', has_text='Mohammed').click()
    pg.wait_for_selector('.balance-hero')
    bal_before = pg.locator('.balance-hero b').inner_text(); print('Mohammed balance:', bal_before)
    pg.get_by_role('button', name='Got payment').click()
    pg.locator('.sheet .amount-input input').first.fill('500')
    pg.get_by_role('button', name='Save payment').click()
    pg.wait_for_timeout(800)
    bal_after = pg.locator('.balance-hero b').inner_text(); print('after ₹500 payment:', bal_after)
    n = lambda s: float(re.sub(r'[^0-9.]', '', s))
    assert abs(n(bal_before) - n(bal_after) - 500) < 0.01
    pg.screenshot(path=OUT + '08_customer.png', full_page=True)

    # Inventory: oil stock dropped by 2
    pg.goto(URL + '#/inventory'); pg.wait_for_selector('.stat-strip')
    pg.wait_for_timeout(400)
    pg.screenshot(path=OUT + '09_inventory.png', full_page=True)
    oil = pg.locator('.row', has_text='Coconut Oil').inner_text(); print('oil row:', oil.replace('\n', ' | '))
    pg.locator('.row', has_text='Coconut Oil').click(); pg.wait_for_selector('.balance-hero')
    pg.screenshot(path=OUT + '10_product.png', full_page=True)

    # Expense
    pg.goto(URL + '#/expenses/new'); pg.wait_for_selector('.tile-grid')
    pg.get_by_role('button', name='Electricity').click()
    pg.locator('.amount-input input').fill('250')
    pg.get_by_role('button', name='Save expense').click(); pg.wait_for_timeout(800)

    # Home reflects everything
    pg.goto(URL + '#/'); pg.wait_for_selector('.today-card'); pg.wait_for_timeout(500)
    print('today sales after:', pg.locator('.today-amount').inner_text(), '| grid:', pg.locator('.today-grid').inner_text().replace('\n', ' '))
    pg.screenshot(path=OUT + '11_home_after.png', full_page=True)

    # Malayalam
    pg.goto(URL + '#/more/settings'); pg.wait_for_selector('.chips')
    pg.get_by_role('button', name='മലയാളം').click()
    pg.goto(URL + '#/'); pg.wait_for_selector('.today-card'); pg.wait_for_timeout(600)
    pg.screenshot(path=OUT + '12_home_ml.png', full_page=True)
    pg.goto(URL + '#/khata'); pg.wait_for_selector('.khata-hero'); pg.wait_for_timeout(300)
    pg.screenshot(path=OUT + '13_khata_ml.png')
    b.close()
print('console errors:', errors or 'none')
print('E2E OK')

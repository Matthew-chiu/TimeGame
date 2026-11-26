# Bullet Swap (test build)

Upload a Word resume (.docx), swap bullet points in and out, and save a new .docx that keeps
the original fonts, spacing and layout. A live preview shows the result as you edit.

Everything runs in your browser. Your resume is never uploaded anywhere: the page reads and
edits the file on your own computer.

## Using it

Open the site link and drag in your .docx. Nothing to install.

## Running it locally

It's a static site with no build step. Serve this folder with any web server, for example:

    python3 -m http.server 8000

then open http://localhost:8000.

## How to use

- **Upload:** drag your .docx onto the page. Bullets are grouped by job or section.
- **Swap:** click any bullet to pick a different one from that section's bank.
  Use ↑ ↓ to reorder, × to drop a bullet, and **+ Add bullet** for an extra slot.
- **Bullet bank:** open it under each section to write new bullets. Banks are remembered
  in your browser, so re-uploading the same resume keeps them.
- **Length chip:** shows how many characters longer or shorter a bullet is than the
  original one in that spot. Red means much longer, so it may push your resume onto a second page.
- **Versions:** name and save a set of choices, then load it back later.
- **Save to folder** (Chrome and Edge): pick a folder once; after that, saving writes
  `<file name>.docx` straight into it and **replaces** a file with that name (it asks first),
  so you don't get "resume (1).docx". Other browsers show **Download** instead, which uses
  the browser's normal download.

## Known limits

- The preview is close to Word but not exact. Check the final page in Word or Google Docs.
  If your resume uses a font that only Word has (such as Calibri or Cambria), the preview
  substitutes a similar one, so lines may wrap slightly differently.
- Swapped bullets use the formatting of the original bullet's first word. Bold or italic
  text in the middle of a bullet isn't kept yet.
- For a PDF: open the saved .docx in Word or Google Docs and export it as PDF.

## Feedback I'm looking for

- Did it find all your bullets, and group them under the right jobs?
- Does the saved .docx look identical to your original, apart from the bullets you changed?
- Does the preview match what Word shows? Screenshots of any differences help a lot.
- Anything confusing in the page itself?

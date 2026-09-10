# Precision Decision LLC Website

This repository contains a minimal static public website for Precision Decision LLC at `precisiondecisionllc.com`.

The site is plain HTML and CSS. The company pages present Precision Decision LLC as a software development company, with product-specific information and support links kept accessible for business verification, including Apple Developer Organization enrollment.

## Company and Product Pages

- `index.html`, `about.html`, and `contact.html` describe the company broadly. Do not add unannounced product names, technical details, or development plans without the owner's approval.
- Keep the company name, `admin@precisiondecisionllc.com`, and `CNAME` consistent. The homepage's Product Information & Support section links to the options app's existing documents.
- Preserve `/privacy.html`, `/terms.html`, `/licenses.html`, `/option-engines/`, and all existing `/option-engines/` policy, risk, subscription, and account-deletion routes. Applications or external reviewers may link directly to them.
- `/privacy.html` is the newer Contract Terminal policy dated September 8, 2026. The legacy `/option-engines/privacy/` document and several other documents still use Options Terminal. Do not replace the newer root policy with the older one.
- The older terms/subscription pages and newer privacy policy contain different descriptions of purchase support. Any reconciliation requires checking the options app's current behavior; company marketing edits must not guess or change those terms.
- CNC application assets are maintained in a separate source repository. Do not change those files as part of company copy updates.

The company copy revision presents the business as a software developer without naming the CNC application. Verification covered 12 HTML pages and 203 local links/assets, plus browser navigation to the current privacy policy, account-deletion instructions, and contact page. Product documents, shared styles, and domain configuration were preserved.

## Preview Locally

Open `index.html` directly in a web browser.

On Windows, you can double-click `index.html` from File Explorer, or open:

```text
C:\dev\precisiondecisionllc-site\index.html
```

## Deploy to Cloudflare Pages

1. Create a new Cloudflare Pages project.
2. Connect this repository, or upload the static site files.
3. Use the repository root as the build output location.
4. Leave the build command blank because this site does not use a build system.
5. Deploy the project.
6. Add the custom domain `precisiondecisionllc.com` in Cloudflare Pages and follow Cloudflare's DNS instructions.

## Deploy to GitHub Pages

1. Create a GitHub repository for this site.
2. Push this repository to GitHub.
3. In the GitHub repository settings, open Pages.
4. Choose the branch and root folder that contain `index.html`.
5. Save the Pages settings and wait for GitHub to publish the site.
6. Configure the custom domain `precisiondecisionllc.com` in GitHub Pages and add the DNS records GitHub provides.

## DNS Notes for precisiondecisionllc.com

- If using Cloudflare Pages, add the custom domain in Cloudflare Pages and follow Cloudflare's DNS instructions.
- If using GitHub Pages, configure the custom domain in GitHub Pages and add the DNS records GitHub provides.

## Apple Enrollment Notes

- Organization website: `https://precisiondecisionllc.com`
- Work email: `admin@precisiondecisionllc.com`
- Legal entity name: `Precision Decision LLC`

# Student hosting options

Checked against official sources on September 13, 2026. Drug Tracker is intended for `https://treeezh.com/drug`. No provider is deployed yet. Discounts require approval in the account that will own the service.

| Service | Student benefit / small plan | Fit for this project |
| --- | --- | --- |
| Azure for Students | $100 credit for 12 months; no credit card; student subscription can be renewed while eligible | Least backend change: the existing Node.js process and persistent SQLite database can run on a VM. VM, disk, IP and bandwidth must all fit the allowance. Managing the server remains our responsibility. |
| Heroku for GitHub Students | $13 credit per month for 24 months; unused monthly credits expire; credit card verification required | Best alternative for avoiding VM maintenance. A Basic dyno ($7/month, always on) plus Essential-0 Postgres ($5/month) totals approximately $12/month before extras, within the student credit. Requires replacing SQLite persistence with PostgreSQL and adapting runtime configuration. |
| Appwrite Education | Two projects with Pro-equivalent resources while the GitHub student eligibility remains valid | Long-lasting student benefit, with managed authentication and storage. Requires a larger backend integration change. Client-side encryption would still be required; provider encryption at rest is not end-to-end encryption. |
| Netlify | Public Free plan: 300 credits/month; Personal: $9/month with 1,000 credits | Suitable for the static public simulator. Full login and encrypted sync require adapting the backend to Functions and persistent managed storage, or a separate API host. No special student entitlement was verified. |
| Railway | Hobby minimum $5/month including $5 resource usage; overage metered; persistent volumes available | Small deployment change for the existing server, but no verified student-specific benefit. Set the applicable hard usage limit and confirm what it covers. |
| Render | Paid web service $7/month plus persistent disk $0.25/GB/month | A 1 GB disk gives a roughly $7.25/month starting configuration before extras. The free web service sleeps and does not provide persistent disk for this SQLite service. |

For the present code, Azure remains the shortest deployment route. Heroku is the preferred student alternative if managed hosting matters more than avoiding a database migration. Appwrite is worth considering if maximizing benefits throughout university is the priority.

Heroku credit is not an unlimited free subscription: extra services, usage beyond the credit, and services left running after the 24-month benefit are billable. Its old help page still mentions 12 months; the current program page, GitHub Pack and detailed program FAQ say 24 months. Confirm the awarded entitlement in the actual account before provisioning.

A Netlify static deployment alone does not provide the application's cloud accounts or vault. Netlify Functions currently have a 60-second synchronous limit and a 6 MB buffered payload limit; the current encrypted vault API accepts larger envelopes. A migration needs payload and storage work as well as a function wrapper.

DNS selects hosts, not `/drug` URL paths. Hosting the root homepage on one provider and Drug Tracker on another needs an HTTP reverse proxy or route, with the expected origin, cookies and API prefix tested. Do not use an ephemeral filesystem for account or vault data.

## Official sources

- [Azure for Students](https://azure.microsoft.com/en-us/free/students)
- [GitHub Student Developer Pack](https://education.github.com/pack)
- [Heroku student offer](https://www.heroku.com/github-students/)
- [Heroku program details](https://help.heroku.com/Z3RHNRHD/how-does-the-heroku-for-github-students-program-work)
- [Heroku sign-up and card verification](https://help.heroku.com/MV88YDXQ/how-do-i-sign-up-for-the-heroku-github-student-program)
- [Heroku current pricing](https://www.heroku.com/pricing/)
- [Appwrite Education](https://appwrite.io/education)
- [Netlify pricing](https://www.netlify.com/pricing/)
- [Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/)
- [Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/)
- [Railway pricing](https://railway.com/pricing)
- [Railway cost control](https://docs.railway.com/pricing/cost-control)
- [Railway volumes](https://docs.railway.com/volumes)
- [Render pricing](https://render.com/pricing)
- [Render free services](https://render.com/docs/free)
- [Render disks](https://render.com/docs/disks)

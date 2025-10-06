{
"version": 2,
"builds": [
{
"src": "ContactForm.jsx",
"use": "@vercel/node",
"config": {
"includeFiles": ["package.json"]
}
}
],
"routes": [
{
"src": "/.*",
"dest": "ContactForm.jsx"
}
]
}

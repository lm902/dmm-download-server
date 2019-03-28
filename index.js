#!/usr/bin/env node
const Koa = require('koa')
const Router = require('koa-router')
const dmmplaylist = require('./dmmplaylist.monthly.js')

const app = new Koa()
const router = new Router()

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0'

router.get('/', async (ctx, next) => {
  ctx.type = 'application/zip'
  ctx.body = await dmmplaylist([ctx.query.productid])
  await next()
})

app.use(router.routes())
app.use(router.allowedMethods())

app.use((ctx, next) => {
  console.log(`[${new Date()}] ${ctx.ip} ${ctx.query.productid}`)
  next()
})

app.listen(process.env.PORT || 5000)

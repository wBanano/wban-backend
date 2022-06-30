#FROM node:14-alpine as builder
#WORKDIR /app
#COPY . .
#RUN yarn install && yarn build

#FROM node:14-alpine as runtime
#WORKDIR /app
#COPY --from=builder /app/dist ./dist
#COPY --from=builder ["/app/package.json", "/app/yarn.lock", "./"]
#RUN yarn install --prod

#EXPOSE 3000

#CMD [ "node", "./dist/app.js" ]

FROM node:16-alpine
WORKDIR /app
COPY . .

RUN yarn install

CMD ["yarn", "start"]

EXPOSE 3000

import * as persistly from "../index"

describe("Update", () => {
	it("toMongo", () => {
		const argument = { name: "test", field: { $set: 1337 }, property: { nested: 42 }, remove: { $unset: true } }
		const filter = persistly.Update.toMongo(argument)
		expect(filter).toEqual({ $set: { name: "test", field: 1337, "property.nested": 42 }, $unset: { remove: true } })
	})
})

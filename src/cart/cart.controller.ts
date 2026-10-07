import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { notFound } from '../common/app-error.js';
import { CART_COOKIE, writeCartToken } from './cart-cookie.js';
import { cartOwner } from './cart-owner.js';
import { AddCartItemDto, CartDto, UpdateCartItemDto } from './cart.dto.js';
import { CartService } from './cart.service.js';

@ApiTags('Cart')
@ApiCookieAuth(CART_COOKIE)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  /** No cart yet = empty cart; nothing is created just for looking. */
  @Get()
  @ApiOkResponse({ type: CartDto })
  async get(@Req() req: Request): Promise<CartDto> {
    return this.cart.view(await this.cart.findCartId(cartOwner(req)));
  }

  @Post('items')
  @ApiOkResponse({ type: CartDto })
  async add(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: AddCartItemDto,
  ): Promise<CartDto> {
    let owner = cartOwner(req);
    if (!owner || 'guestToken' in owner) {
      const guestToken = owner?.guestToken ?? this.cart.newToken();
      writeCartToken(res, guestToken); // set or refresh the 30-day expiry
      owner = { guestToken };
    }
    const cartId = await this.cart.getOrCreateCartId(owner);
    await this.cart.addItem(cartId, body.variantId, body.quantity);
    return this.cart.view(cartId);
  }

  @Patch('items/:id')
  @ApiOkResponse({ type: CartDto })
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCartItemDto,
  ): Promise<CartDto> {
    const cartId = await this.requireCart(req);
    await this.cart.updateItem(cartId, id, body.quantity);
    return this.cart.view(cartId);
  }

  @Delete('items/:id')
  @ApiOkResponse({ type: CartDto })
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string): Promise<CartDto> {
    const cartId = await this.requireCart(req);
    await this.cart.removeItem(cartId, id);
    return this.cart.view(cartId);
  }

  private async requireCart(req: Request) {
    const cartId = await this.cart.findCartId(cartOwner(req));
    if (!cartId) throw notFound('That item is not in your cart.');
    return cartId;
  }
}

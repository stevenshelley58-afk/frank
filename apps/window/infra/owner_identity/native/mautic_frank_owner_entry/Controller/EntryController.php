<?php
namespace MauticPlugin\FrankOwnerEntryBundle\Controller;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;
final class EntryController extends AbstractController
{
    /** The /s/ firewall protects this route; prove the mapped native owner only. */
    public function sessionAction(): JsonResponse
    {
        $user = $this->getUser();
        $authenticated = $user !== null && $user->getUserIdentifier() === 'owner';
        return new JsonResponse(['authenticated' => $authenticated], $authenticated ? 200 : 403);
    }

    /** This route is behind Mautic's /s/ firewall. Never accept a return URL. */
    public function returnAction(): RedirectResponse
    {
        return new RedirectResponse('/frank/bridge?app=campaigns&return=1', 302);
    }
}
